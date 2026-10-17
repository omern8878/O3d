//! Engine core: a data-oriented entity buffer designed for zero-copy JS interop.
//!
//! # Layout (Struct of Arrays + Sparse Set)
//!
//! Entity data lives in *dense*, tightly packed arrays so that systems (and JS
//! typed-array views) can iterate over active entities linearly:
//!
//! ```text
//! dense index   0        1        2        3
//! positions   [x y z | x y z | x y z | x y z ]   <- f32 x 3 per entity
//! colors      [r g b | r g b | r g b | r g b ]   <- f32 x 3 per entity
//! ```
//!
//! External callers never see dense indices as identity. They hold a stable
//! *entity ID*, which the sparse set maps to the entity's current dense slot:
//!
//! ```text
//! sparse_to_dense[entity_id] -> dense index
//! dense_to_sparse[dense_idx] -> entity_id
//! ```
//!
//! Removal uses "swap and pop" so the dense arrays never contain holes.
//!
//! # Zero-copy contract
//!
//! JS builds `Float32Array` views over WASM linear memory using
//! [`EntityBuffer::positions_ptr`] / [`EntityBuffer::colors_ptr`]. Those views
//! are **invalidated whenever the buffer grows** (WASM memory may be
//! reallocated), so JS must re-create them after any call that can allocate,
//! e.g. when [`EntityBuffer::capacity`] changes.

use wasm_bindgen::prelude::*;

/// Number of `f32` components stored per entity in each attribute array.
const FLOATS_PER_ENTITY: usize = 3;

/// Sentinel stored in `sparse_to_dense` for IDs that are not currently alive.
const INVALID_INDEX: usize = usize::MAX;

// ---------------------------------------------------------------------------
// Smoke-test entry point
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn init_engine() -> String {
    "Engine Core Initialized!".to_string()
}

// ---------------------------------------------------------------------------
// Memory access
// ---------------------------------------------------------------------------

/// Returns the WASM linear memory so JS can create typed-array views over it.
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

// ---------------------------------------------------------------------------
// EntityBuffer
// ---------------------------------------------------------------------------

/// Sparse-set backed, SoA entity storage.
#[wasm_bindgen]
pub struct EntityBuffer {
    /// Number of currently active entities (== used dense slots).
    active_count: usize,
    /// Dense positions: `[x, y, z]` per entity, indexed by dense slot.
    positions: Vec<f32>,
    /// Dense colors: `[r, g, b]` per entity, indexed by dense slot.
    colors: Vec<f32>,
    /// Entity ID -> dense index (`INVALID_INDEX` if the ID is not alive).
    sparse_to_dense: Vec<usize>,
    /// Dense index -> entity ID. Its length always equals `active_count`.
    dense_to_sparse: Vec<usize>,
    /// Recycled entity IDs, reused before minting new ones.
    free_ids: Vec<usize>,
}

#[wasm_bindgen]
impl EntityBuffer {
    /// Creates a buffer with room for `initial_capacity` entities.
    ///
    /// The attribute arrays are zero-filled up to full capacity so every slot
    /// JS may write into is initialized memory.
    #[wasm_bindgen(constructor)]
    pub fn new(initial_capacity: usize) -> EntityBuffer {
        let floats = initial_capacity * FLOATS_PER_ENTITY;

        let mut positions = Vec::with_capacity(floats);
        let mut colors = Vec::with_capacity(floats);
        positions.resize(floats, 0.0);
        colors.resize(floats, 0.0);

        EntityBuffer {
            active_count: 0,
            positions,
            colors,
            sparse_to_dense: Vec::with_capacity(initial_capacity),
            dense_to_sparse: Vec::with_capacity(initial_capacity),
            free_ids: Vec::new(),
        }
    }

    /// Creates a new entity and returns its stable external ID.
    ///
    /// The entity's position and color start zeroed. May grow (and therefore
    /// relocate) the dense arrays; see the module-level zero-copy contract.
    pub fn allocate_entity(&mut self) -> usize {
        if self.active_count == self.slot_count() {
            self.grow();
        }

        let dense_idx = self.active_count;
        let entity_id = self.acquire_id(dense_idx);

        self.dense_to_sparse.push(entity_id);
        self.clear_slot(dense_idx);
        self.active_count += 1;

        entity_id
    }

    /// Destroys an entity, keeping the dense arrays gap-free via swap-and-pop.
    ///
    /// Unknown or already-removed IDs are ignored.
    pub fn remove_entity(&mut self, entity_id: usize) {
        let dense_idx = self.get_dense_index(entity_id);
        if dense_idx == INVALID_INDEX {
            return;
        }

        let last_idx = self.active_count - 1;

        // Move the last active entity into the hole (no-op if it *is* the hole).
        self.move_slot(last_idx, dense_idx);

        // Re-point the moved entity's ID at its new dense slot.
        let moved_id = self.dense_to_sparse[last_idx];
        self.sparse_to_dense[moved_id] = dense_idx;
        self.dense_to_sparse[dense_idx] = moved_id;

        // Retire the removed ID and shrink the dense range.
        self.dense_to_sparse.pop();
        self.sparse_to_dense[entity_id] = INVALID_INDEX;
        self.free_ids.push(entity_id);
        self.active_count -= 1;
    }

    // ----- Zero-copy accessors -------------------------------------------

    /// Pointer to the dense positions array (`f32` x 3 per entity).
    pub fn positions_ptr(&self) -> *const f32 {
        self.positions.as_ptr()
    }

    /// Pointer to the dense colors array (`f32` x 3 per entity).
    pub fn colors_ptr(&self) -> *const f32 {
        self.colors.as_ptr()
    }

    /// Number of currently active entities.
    pub fn active_count(&self) -> usize {
        self.active_count
    }

    /// Maximum number of entities storable before the next reallocation.
    pub fn capacity(&self) -> usize {
        self.positions.capacity() / FLOATS_PER_ENTITY
    }

    /// Current dense index of `entity_id`, so JS knows where to write
    /// (element offset into the views is `dense_index * 3`).
    ///
    /// Returns `usize::MAX` if the entity is not alive.
    pub fn get_dense_index(&self, entity_id: usize) -> usize {
        self.sparse_to_dense
            .get(entity_id)
            .copied()
            .unwrap_or(INVALID_INDEX)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported to JS)
// ---------------------------------------------------------------------------

impl EntityBuffer {
    /// Picks an entity ID (recycled first, otherwise new) and maps it to
    /// `dense_idx` in the sparse array.
    fn acquire_id(&mut self, dense_idx: usize) -> usize {
        match self.free_ids.pop() {
            Some(id) => {
                self.sparse_to_dense[id] = dense_idx;
                id
            }
            None => {
                self.sparse_to_dense.push(dense_idx);
                self.sparse_to_dense.len() - 1
            }
        }
    }

    /// Number of initialized dense slots. Unlike `Vec::capacity`, this is exact,
    /// so it is the value allocation decisions are based on.
    fn slot_count(&self) -> usize {
        self.positions.len() / FLOATS_PER_ENTITY
    }

    /// Doubles the slot count (minimum 1) and zero-fills the new slots.
    fn grow(&mut self) {
        let new_floats = (self.slot_count().max(1) * 2) * FLOATS_PER_ENTITY;

        for array in [&mut self.positions, &mut self.colors] {
            array.reserve_exact(new_floats - array.len());
            array.resize(new_floats, 0.0);
        }
    }

    /// Zeroes the position and color of a dense slot.
    fn clear_slot(&mut self, dense_idx: usize) {
        let range = Self::slot_range(dense_idx);
        self.positions[range.clone()].fill(0.0);
        self.colors[range].fill(0.0);
    }

    /// Copies the 3 floats of every attribute from slot `from` into slot `to`.
    fn move_slot(&mut self, from: usize, to: usize) {
        let src = Self::slot_range(from);
        self.positions.copy_within(src.clone(), to * FLOATS_PER_ENTITY);
        self.colors.copy_within(src, to * FLOATS_PER_ENTITY);
    }

    /// Float range occupied by a dense slot within an attribute array.
    fn slot_range(dense_idx: usize) -> std::ops::Range<usize> {
        let start = dense_idx * FLOATS_PER_ENTITY;
        start..start + FLOATS_PER_ENTITY
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn set_position(buf: &mut EntityBuffer, id: usize, value: f32) {
        let start = buf.get_dense_index(id) * FLOATS_PER_ENTITY;
        buf.positions[start..start + FLOATS_PER_ENTITY].fill(value);
    }

    fn position_of(buf: &EntityBuffer, id: usize) -> f32 {
        buf.positions[buf.get_dense_index(id) * FLOATS_PER_ENTITY]
    }

    #[test]
    fn allocates_sequential_ids_and_grows() {
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
    fn remove_swaps_last_into_hole() {
        let mut buf = EntityBuffer::new(4);
        let a = buf.allocate_entity();
        let b = buf.allocate_entity();
        let c = buf.allocate_entity();
        set_position(&mut buf, a, 1.0);
        set_position(&mut buf, b, 2.0);
        set_position(&mut buf, c, 3.0);

        buf.remove_entity(a);

        assert_eq!(buf.active_count(), 2);
        assert_eq!(buf.get_dense_index(a), INVALID_INDEX);
        assert_eq!(buf.get_dense_index(c), 0);
        assert_eq!(position_of(&buf, c), 3.0);
        assert_eq!(position_of(&buf, b), 2.0);
    }

    #[test]
    fn removing_last_entity_is_safe() {
        let mut buf = EntityBuffer::new(2);
        let a = buf.allocate_entity();
        buf.remove_entity(a);
        assert_eq!(buf.active_count(), 0);
    }

    #[test]
    fn recycles_ids_with_zeroed_data() {
        let mut buf = EntityBuffer::new(2);
        let a = buf.allocate_entity();
        set_position(&mut buf, a, 9.0);
        buf.remove_entity(a);

        let reused = buf.allocate_entity();
        assert_eq!(reused, a);
        assert_eq!(position_of(&buf, reused), 0.0);
    }

    #[test]
    fn ignores_invalid_and_double_removal() {
        let mut buf = EntityBuffer::new(2);
        let a = buf.allocate_entity();
        buf.remove_entity(a);
        buf.remove_entity(a);
        buf.remove_entity(42);

        assert_eq!(buf.active_count(), 0);
        assert_eq!(buf.allocate_entity(), a);
        assert_eq!(buf.allocate_entity(), 1);
    }
}
