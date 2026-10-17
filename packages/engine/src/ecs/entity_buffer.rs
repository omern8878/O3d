//! Wasm-facing SoA entity storage with zero-copy JS access.
//!
//! Per-entity attributes live in dense, tightly packed `f32` arrays (3 floats
//! per entity) so JS can build typed-array views over them:
//!
//! ```text
//! dense index   0        1        2
//! positions   [x y z | x y z | x y z ]
//! scales      [x y z | x y z | x y z ]
//! colors      [r g b | r g b | r g b ]
//! ```
//!
//! Identity and slot bookkeeping is delegated to [`SparseSet`]; this type only
//! owns the data arrays and keeps them aligned with the index.
//!
//! # Zero-copy contract
//!
//! Views created from `*_ptr()` are **invalidated whenever the buffer grows**
//! (Wasm memory may be reallocated). JS must re-create them after any call that
//! can allocate, e.g. when [`EntityBuffer::capacity`] changes.

use wasm_bindgen::prelude::*;

use super::sparse_set::SparseSet;

/// Number of `f32` components stored per entity in each attribute array.
const FLOATS_PER_VEC3: usize = 3;

const DEFAULT_POSITION: [f32; 3] = [0.0, 0.0, 0.0];
const DEFAULT_SCALE: [f32; 3] = [1.0, 1.0, 1.0];
const DEFAULT_COLOR: [f32; 3] = [0.0, 0.0, 0.0];

/// Contiguous SoA entity data indexed through a [`SparseSet`].
#[wasm_bindgen]
pub struct EntityBuffer {
    index: SparseSet,
    positions: Vec<f32>,
    scales: Vec<f32>,
    colors: Vec<f32>,
}

#[wasm_bindgen]
impl EntityBuffer {
    /// Creates a buffer with room for `initial_capacity` entities.
    ///
    /// Arrays are zero-filled to full capacity so every slot JS may write into
    /// is initialized memory.
    #[wasm_bindgen(constructor)]
    pub fn new(initial_capacity: usize) -> EntityBuffer {
        let floats = initial_capacity * FLOATS_PER_VEC3;

        EntityBuffer {
            index: SparseSet::with_capacity(initial_capacity),
            positions: Self::zeroed_array(floats),
            scales: Self::zeroed_array(floats),
            colors: Self::zeroed_array(floats),
        }
    }

    /// Creates an entity with default attributes and returns its stable ID.
    ///
    /// Defaults: position `(0, 0, 0)`, scale `(1, 1, 1)`, color `(0, 0, 0)`.
    /// May grow (and relocate) the arrays; see the zero-copy contract above.
    pub fn allocate_entity(&mut self) -> usize {
        if self.index.active_count() == self.slot_count() {
            self.grow();
        }

        let (entity_id, dense_idx) = self.index.allocate();
        Self::write_vec3(&mut self.positions, dense_idx, DEFAULT_POSITION);
        Self::write_vec3(&mut self.scales, dense_idx, DEFAULT_SCALE);
        Self::write_vec3(&mut self.colors, dense_idx, DEFAULT_COLOR);

        entity_id
    }

    /// Destroys an entity, keeping the arrays gap-free. Invalid IDs are ignored.
    pub fn remove_entity(&mut self, entity_id: usize) {
        if let Some((removed_idx, last_idx)) = self.index.remove(entity_id) {
            Self::swap_remove_vec3(&mut self.positions, removed_idx, last_idx);
            Self::swap_remove_vec3(&mut self.scales, removed_idx, last_idx);
            Self::swap_remove_vec3(&mut self.colors, removed_idx, last_idx);
        }
    }

    /// Pointer to the dense positions array (`f32` x 3 per entity).
    pub fn positions_ptr(&self) -> *const f32 {
        self.positions.as_ptr()
    }

    /// Pointer to the dense scales array (`f32` x 3 per entity).
    pub fn scales_ptr(&self) -> *const f32 {
        self.scales.as_ptr()
    }

    /// Pointer to the dense colors array (`f32` x 3 per entity).
    pub fn colors_ptr(&self) -> *const f32 {
        self.colors.as_ptr()
    }

    /// Number of currently active entities.
    pub fn active_count(&self) -> usize {
        self.index.active_count()
    }

    /// Maximum number of entities storable before the next reallocation.
    pub fn capacity(&self) -> usize {
        self.positions.capacity() / FLOATS_PER_VEC3
    }

    /// Current dense index of `entity_id` (JS element offset is `index * 3`),
    /// or `undefined` in JS if the entity is not alive.
    pub fn get_dense_index(&self, entity_id: usize) -> Option<usize> {
        self.index.get_dense_index(entity_id)
    }
}

impl EntityBuffer {
    /// Allocates a zero-filled array of `floats` elements.
    fn zeroed_array(floats: usize) -> Vec<f32> {
        let mut array = Vec::with_capacity(floats);
        array.resize(floats, 0.0);
        array
    }

    /// Number of initialized dense slots. Unlike `Vec::capacity`, this is exact,
    /// so growth decisions are based on it.
    fn slot_count(&self) -> usize {
        self.positions.len() / FLOATS_PER_VEC3
    }

    /// Doubles the slot count (minimum 1), zero-filling the new slots.
    fn grow(&mut self) {
        let new_floats = self.slot_count().max(1) * 2 * FLOATS_PER_VEC3;

        for array in [&mut self.positions, &mut self.scales, &mut self.colors] {
            array.reserve_exact(new_floats - array.len());
            array.resize(new_floats, 0.0);
        }
    }

    /// Overwrites the 3 floats at `dense_idx`.
    fn write_vec3(vec: &mut [f32], dense_idx: usize, value: [f32; 3]) {
        let start = dense_idx * FLOATS_PER_VEC3;
        vec[start..start + FLOATS_PER_VEC3].copy_from_slice(&value);
    }

    /// Copies the 3 floats at `last_idx` over those at `removed_idx`.
    /// A no-op when both are the same slot.
    fn swap_remove_vec3(vec: &mut [f32], removed_idx: usize, last_idx: usize) {
        let last_start = last_idx * FLOATS_PER_VEC3;
        vec.copy_within(
            last_start..last_start + FLOATS_PER_VEC3,
            removed_idx * FLOATS_PER_VEC3,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vec3_at(array: &[f32], dense_idx: usize) -> [f32; 3] {
        let start = dense_idx * FLOATS_PER_VEC3;
        array[start..start + FLOATS_PER_VEC3].try_into().unwrap()
    }

    fn set_position(buf: &mut EntityBuffer, id: usize, value: [f32; 3]) {
        let dense_idx = buf.get_dense_index(id).unwrap();
        EntityBuffer::write_vec3(&mut buf.positions, dense_idx, value);
    }

    fn position_of(buf: &EntityBuffer, id: usize) -> [f32; 3] {
        vec3_at(&buf.positions, buf.get_dense_index(id).unwrap())
    }

    #[test]
    fn new_entities_get_default_attributes() {
        let mut buf = EntityBuffer::new(1);
        let id = buf.allocate_entity();
        let idx = buf.get_dense_index(id).unwrap();

        assert_eq!(vec3_at(&buf.positions, idx), DEFAULT_POSITION);
        assert_eq!(vec3_at(&buf.scales, idx), DEFAULT_SCALE);
        assert_eq!(vec3_at(&buf.colors, idx), DEFAULT_COLOR);
    }

    #[test]
    fn grows_when_capacity_is_exhausted() {
        let mut buf = EntityBuffer::new(1);
        let ids: Vec<_> = (0..5).map(|_| buf.allocate_entity()).collect();

        assert_eq!(ids, vec![0, 1, 2, 3, 4]);
        assert_eq!(buf.active_count(), 5);
        assert!(buf.capacity() >= 5);
    }

    #[test]
    fn grows_from_zero_capacity() {
        let mut buf = EntityBuffer::new(0);
        buf.allocate_entity();

        assert_eq!(buf.active_count(), 1);
        assert!(buf.capacity() >= 1);
    }

    #[test]
    fn remove_moves_last_entity_data_into_hole_for_all_arrays() {
        let mut buf = EntityBuffer::new(3);
        let a = buf.allocate_entity();
        let b = buf.allocate_entity();
        let c = buf.allocate_entity();
        set_position(&mut buf, a, [1.0; 3]);
        set_position(&mut buf, b, [2.0; 3]);
        set_position(&mut buf, c, [3.0; 3]);
        EntityBuffer::write_vec3(&mut buf.scales, 2, [7.0; 3]);
        EntityBuffer::write_vec3(&mut buf.colors, 2, [5.0; 3]);

        buf.remove_entity(a);

        assert_eq!(buf.active_count(), 2);
        assert_eq!(buf.get_dense_index(a), None);
        assert_eq!(buf.get_dense_index(c), Some(0));
        assert_eq!(position_of(&buf, c), [3.0; 3]);
        assert_eq!(position_of(&buf, b), [2.0; 3]);
        assert_eq!(vec3_at(&buf.scales, 0), [7.0; 3]);
        assert_eq!(vec3_at(&buf.colors, 0), [5.0; 3]);
    }

    #[test]
    fn recycled_entities_are_reset_to_defaults() {
        let mut buf = EntityBuffer::new(1);
        let a = buf.allocate_entity();
        set_position(&mut buf, a, [9.0; 3]);
        EntityBuffer::write_vec3(&mut buf.scales, 0, [4.0; 3]);
        buf.remove_entity(a);

        let reused = buf.allocate_entity();

        assert_eq!(reused, a);
        assert_eq!(position_of(&buf, reused), DEFAULT_POSITION);
        assert_eq!(vec3_at(&buf.scales, 0), DEFAULT_SCALE);
    }

    #[test]
    fn invalid_removals_are_ignored() {
        let mut buf = EntityBuffer::new(1);
        let a = buf.allocate_entity();
        buf.remove_entity(a);
        buf.remove_entity(a);
        buf.remove_entity(42);

        assert_eq!(buf.active_count(), 0);
    }
}
