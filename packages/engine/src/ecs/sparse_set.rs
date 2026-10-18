//! Sparse-set index: maps stable entity IDs to densely packed slots.
//!
//! ```text
//! sparse_to_dense[entity_id] -> dense index
//! dense_to_sparse[dense_idx] -> entity_id
//! ```
//!
//! This type owns only the *indexing*. It knows nothing about the data stored
//! per entity; callers keep their own dense arrays and mirror the moves that
//! [`SparseSet::remove`] reports.

/// Marks an entity ID in `sparse_to_dense` as not alive.
const INVALID_INDEX: usize = usize::MAX;

/// Entity ID <-> dense index bookkeeping with ID recycling.
#[derive(Debug, Default)]
pub struct SparseSet {
    /// Number of live entities; also the next free dense index.
    active_count: usize,
    /// Entity ID -> dense index (`INVALID_INDEX` if not alive).
    sparse_to_dense: Vec<usize>,
    /// Dense index -> entity ID. Its length always equals `active_count`.
    dense_to_sparse: Vec<usize>,
    /// Recycled entity IDs, reused before minting new ones.
    free_ids: Vec<usize>,
}

impl SparseSet {
    /// Creates an empty set with index storage reserved for `capacity` entities.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            active_count: 0,
            sparse_to_dense: Vec::with_capacity(capacity),
            dense_to_sparse: Vec::with_capacity(capacity),
            free_ids: Vec::new(),
        }
    }

    /// Registers a new entity and returns `(entity_id, dense_idx)`.
    ///
    /// A recycled ID is preferred over minting a new one. The entity is placed
    /// at the end of the dense range.
    pub fn allocate(&mut self) -> (usize, usize) {
        let dense_idx = self.active_count;

        let entity_id = match self.free_ids.pop() {
            Some(id) => {
                self.sparse_to_dense[id] = dense_idx;
                id
            }
            None => {
                self.sparse_to_dense.push(dense_idx);
                self.sparse_to_dense.len() - 1
            }
        };

        self.dense_to_sparse.push(entity_id);
        self.active_count += 1;

        (entity_id, dense_idx)
    }

    /// Unregisters an entity using swap-and-pop on the index arrays.
    ///
    /// Returns `Some((removed_dense_idx, last_dense_idx))`. The caller must move
    /// its data from `last_dense_idx` into `removed_dense_idx` to keep its dense
    /// arrays aligned (the two are equal when the last entity was removed).
    /// Returns `None` if `entity_id` is not alive.
    pub fn remove(&mut self, entity_id: usize) -> Option<(usize, usize)> {
        let removed_idx = self.get_dense_index(entity_id)?;
        let last_idx = self.active_count - 1;

        // Re-point the entity that fills the hole at its new dense index.
        let moved_id = self.dense_to_sparse[last_idx];
        self.dense_to_sparse[removed_idx] = moved_id;
        self.sparse_to_dense[moved_id] = removed_idx;

        // Retire the removed ID. Must come after the re-pointing above, since
        // `moved_id == entity_id` when the last entity is the one removed.
        self.dense_to_sparse.pop();
        self.sparse_to_dense[entity_id] = INVALID_INDEX;
        self.free_ids.push(entity_id);
        self.active_count -= 1;

        Some((removed_idx, last_idx))
    }

    /// Current dense index of `entity_id`, or `None` if it is not alive.
    pub fn get_dense_index(&self, entity_id: usize) -> Option<usize> {
        self.sparse_to_dense
            .get(entity_id)
            .copied()
            .filter(|&dense_idx| dense_idx != INVALID_INDEX)
    }

    /// Number of live entities.
    /// The entity ID stored at `dense_index`, or `None` past the active range.
    pub fn entity_id_at_dense(&self, dense_index: usize) -> Option<usize> {
        self.dense_to_sparse.get(dense_index).copied()
    }

    pub fn active_count(&self) -> usize {
        self.active_count
    }
}

#[cfg(test)]
#[path = "sparse_set_tests.rs"]
mod tests;
