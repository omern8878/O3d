//! CPU frustum culling by stream compaction.
//!
//! [`CullingBuffer::cull`] walks the active entities of an [`EntityBuffer`] and
//! copies only the ones inside the camera frustum into tightly packed output
//! arrays. JS can upload those arrays to the GPU as-is, so off-screen entities
//! cost neither upload bandwidth nor vertex work.
//!
//! # Zero-copy contract
//!
//! The `visible_*_ptr()` pointers are valid until the next `cull()`, which may
//! reallocate the arrays. Re-read them after every cull.

use wasm_bindgen::prelude::*;

use super::entity_buffer::EntityBuffer;
use crate::math::camera::Camera;
use crate::math::frustum::Frustum;

const FLOATS_PER_VEC3: usize = 3;

/// Visible entities from the last `cull()`, packed in dense (original) order.
#[wasm_bindgen]
pub struct CullingBuffer {
    visible_positions: Vec<f32>,
    visible_scales: Vec<f32>,
    visible_colors: Vec<f32>,
    /// Dense index each visible instance had in the source buffer.
    visible_ids: Vec<u32>,
    visible_count: usize,
}

#[wasm_bindgen]
impl CullingBuffer {
    /// Reserves room for `initial_capacity` visible entities.
    #[wasm_bindgen(constructor)]
    pub fn new(initial_capacity: usize) -> CullingBuffer {
        let floats = initial_capacity * FLOATS_PER_VEC3;
        CullingBuffer {
            visible_positions: Vec::with_capacity(floats),
            visible_scales: Vec::with_capacity(floats),
            visible_colors: Vec::with_capacity(floats),
            visible_ids: Vec::with_capacity(initial_capacity),
            visible_count: 0,
        }
    }

    /// Replaces the visible set with the entities of `buffer` inside `camera`'s
    /// frustum, and returns how many there are. Allocated capacity is reused.
    pub fn cull(&mut self, buffer: &EntityBuffer, camera: &Camera) -> usize {
        let frustum = Frustum::from_view_proj(camera.view_proj_mat());
        self.clear();

        let positions = buffer.positions_slice();
        let scales = buffer.scales_slice();
        let colors = buffer.colors_slice();

        for i in 0..buffer.active_count() {
            let range = i * FLOATS_PER_VEC3..(i + 1) * FLOATS_PER_VEC3;
            let position = [
                positions[range.start],
                positions[range.start + 1],
                positions[range.start + 2],
            ];
            let scale = [
                scales[range.start],
                scales[range.start + 1],
                scales[range.start + 2],
            ];

            if frustum.contains_entity(position, scale) {
                self.visible_positions
                    .extend_from_slice(&positions[range.clone()]);
                self.visible_scales
                    .extend_from_slice(&scales[range.clone()]);
                self.visible_colors.extend_from_slice(&colors[range]);
                self.visible_ids.push(i as u32);
                self.visible_count += 1;
            }
        }

        self.visible_count
    }

    /// Number of entities that passed the last `cull()`.
    pub fn visible_count(&self) -> usize {
        self.visible_count
    }

    pub fn visible_positions_ptr(&self) -> *const f32 {
        self.visible_positions.as_ptr()
    }

    pub fn visible_scales_ptr(&self) -> *const f32 {
        self.visible_scales.as_ptr()
    }

    pub fn visible_colors_ptr(&self) -> *const f32 {
        self.visible_colors.as_ptr()
    }

    /// Source dense indices of the visible instances, for debugging or picking.
    pub fn visible_ids_ptr(&self) -> *const u32 {
        self.visible_ids.as_ptr()
    }
}

impl CullingBuffer {
    /// Empties the outputs without releasing their allocations.
    fn clear(&mut self) {
        self.visible_positions.clear();
        self.visible_scales.clear();
        self.visible_colors.clear();
        self.visible_ids.clear();
        self.visible_count = 0;
    }
}

#[cfg(test)]
#[path = "culling_buffer_tests.rs"]
mod tests;
