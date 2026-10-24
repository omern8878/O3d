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

/// Upper bound on the capacity a caller may request up front. Larger requests
/// would exhaust Wasm memory (a trap, not a catchable error) or overflow the
/// float count.
const MAX_INITIAL_CAPACITY: usize = 1 << 22;

/// Returned by `remove_entity` when no remaining dense slot was overwritten.
const NO_SLOT_OVERWRITTEN: isize = -1;

/// Most entities one `allocate_entities` call creates (16,777,216). Not a
/// scene limit (call again for more): it keeps one JS-supplied count from
/// requesting more memory than wasm32 can address, which would trap.
const MAX_BATCH_ALLOCATION: usize = 1 << 24;

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
    /// Creates a buffer with room for `initial_capacity` entities, clamped to
    /// `[1, 4_194_304]`.
    ///
    /// Arrays are zero-filled to full capacity so every slot JS may write into
    /// is initialized memory.
    #[wasm_bindgen(constructor)]
    pub fn new(initial_capacity: usize) -> EntityBuffer {
        let initial_capacity = initial_capacity.clamp(1, MAX_INITIAL_CAPACITY);
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

    /// Creates `count` entities with default attributes and returns their IDs.
    ///
    /// They occupy the dense indices directly after the current active
    /// entities, in order, so JS can fill them with one contiguous write per
    /// attribute. At most 16,777,216 are created per call.
    pub fn allocate_entities(&mut self, count: usize) -> Vec<u32> {
        let count = count.min(MAX_BATCH_ALLOCATION);
        (0..count).map(|_| self.allocate_entity() as u32).collect()
    }

    /// Destroys many entities in one call (one Wasm boundary crossing instead
    /// of one per entity). Invalid and repeated IDs are ignored.
    ///
    /// Returns every dense index whose data was overwritten by a swap, for
    /// marking dirty. An index can appear more than once, or end up beyond
    /// the final active count; callers clamp to the active range.
    pub fn remove_entities(&mut self, entity_ids: &[u32]) -> Vec<u32> {
        entity_ids
            .iter()
            .filter_map(|&id| u32::try_from(self.remove_entity(id as usize)).ok())
            .collect()
    }

    /// Destroys an entity, keeping the arrays gap-free. Invalid IDs are ignored.
    ///
    /// Returns the dense index whose data was overwritten by the swap, so
    /// callers can mark it dirty. Returns [`NO_SLOT_OVERWRITTEN`] (`-1`) if the
    /// ID was invalid, or if the removed entity was the last one and was simply
    /// popped (no remaining slot changed).
    pub fn remove_entity(&mut self, entity_id: usize) -> isize {
        let Some((removed_idx, last_idx)) = self.index.remove(entity_id) else {
            return NO_SLOT_OVERWRITTEN;
        };

        Self::swap_remove_vec3(&mut self.positions, removed_idx, last_idx);
        Self::swap_remove_vec3(&mut self.scales, removed_idx, last_idx);
        Self::swap_remove_vec3(&mut self.colors, removed_idx, last_idx);

        if removed_idx == last_idx {
            NO_SLOT_OVERWRITTEN
        } else {
            removed_idx as isize
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
    /// The stable ID of the entity stored at `dense_index`, or `None` if that
    /// slot is not active (or its ID does not fit in `u32`).
    pub(crate) fn entity_id_at_dense(&self, dense_index: usize) -> Option<u32> {
        let entity_id = self.index.entity_id_at_dense(dense_index)?;
        u32::try_from(entity_id).ok()
    }

    /// Active positions: `[x, y, z]` per entity, in dense order.
    pub(crate) fn positions_slice(&self) -> &[f32] {
        &self.positions[..self.active_float_count()]
    }

    /// Active scales: `[x, y, z]` per entity, in dense order.
    pub(crate) fn scales_slice(&self) -> &[f32] {
        &self.scales[..self.active_float_count()]
    }

    /// Active colors: `[r, g, b]` per entity, in dense order.
    pub(crate) fn colors_slice(&self) -> &[f32] {
        &self.colors[..self.active_float_count()]
    }

    /// Test hook: sets every attribute of a live entity from Rust.
    #[cfg(test)]
    pub(crate) fn write_entity(
        &mut self,
        entity_id: usize,
        position: [f32; 3],
        scale: [f32; 3],
        color: [f32; 3],
    ) {
        let dense_idx = self.get_dense_index(entity_id).unwrap();
        Self::write_vec3(&mut self.positions, dense_idx, position);
        Self::write_vec3(&mut self.scales, dense_idx, scale);
        Self::write_vec3(&mut self.colors, dense_idx, color);
    }

    /// Number of `f32`s in use per attribute array.
    fn active_float_count(&self) -> usize {
        self.index.active_count() * FLOATS_PER_VEC3
    }

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
        let new_floats = self.slot_count().max(1).saturating_mul(2 * FLOATS_PER_VEC3);

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
#[path = "entity_buffer_tests.rs"]
mod tests;
