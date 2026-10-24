//! Fixed-capacity 3D line segments, written in place by JS and drawn as one
//! line list.
//!
//! ```text
//! segment       0                          1
//! vertices    [x1 y1 z1 x2 y2 z2        | ...]  f32
//! colors      [rgba1 rgba2              | ...]  u32, r | g << 8 | b << 16 | a << 24
//! ```
//!
//! Each segment owns two vertices with their own color, so a segment can fade
//! from one end to the other. The first `count` segments are drawn.
//!
//! # Zero-copy contract
//!
//! As for `InstanceBuffer`: the arrays never reallocate, so the pointers are
//! stable, but views over them detach when Wasm memory grows.

use wasm_bindgen::prelude::*;

pub const FLOATS_PER_SEGMENT: usize = 6;
pub const COLORS_PER_SEGMENT: usize = 2;

/// Upper bound on the capacity; see `EntityBuffer` for the rationale.
const MAX_CAPACITY: usize = 1 << 22;

const OPAQUE_WHITE: u32 = 0xffff_ffff;

/// Endpoints and endpoint colors of up to `capacity` segments.
#[wasm_bindgen]
pub struct LineBuffer {
    vertices: Vec<f32>,
    colors: Vec<u32>,
    count: usize,
}

#[wasm_bindgen]
impl LineBuffer {
    /// Allocates room for `capacity` segments, clamped to `[1, 4_194_304]`.
    /// Every segment starts collapsed at the origin in opaque white; the
    /// active count starts at `0`.
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> LineBuffer {
        let capacity = capacity.clamp(1, MAX_CAPACITY);
        LineBuffer {
            vertices: vec![0.0; capacity * FLOATS_PER_SEGMENT],
            colors: vec![OPAQUE_WHITE; capacity * COLORS_PER_SEGMENT],
            count: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.vertices.len() / FLOATS_PER_SEGMENT
    }

    /// Number of segments drawn, always `<= capacity()`.
    pub fn count(&self) -> usize {
        self.count
    }

    /// Sets how many leading segments are active, clamped to the capacity,
    /// and returns the value applied. Segments past the count keep their data.
    pub fn set_count(&mut self, count: usize) -> usize {
        self.count = count.min(self.capacity());
        self.count
    }

    /// `capacity * 6` floats: `[x1, y1, z1, x2, y2, z2]` per segment.
    pub fn vertices_ptr(&mut self) -> *mut f32 {
        self.vertices.as_mut_ptr()
    }

    /// `capacity * 2` packed RGBA colors, one per endpoint.
    pub fn colors_ptr(&mut self) -> *mut u32 {
        self.colors.as_mut_ptr()
    }
}

impl LineBuffer {
    pub fn vertices_slice(&self) -> &[f32] {
        &self.vertices
    }

    pub fn colors_slice(&self) -> &[u32] {
        &self.colors
    }
}

#[cfg(test)]
#[path = "line_buffer_tests.rs"]
mod tests;
