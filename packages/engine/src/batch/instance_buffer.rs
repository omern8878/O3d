//! Fixed-capacity per-instance data for hardware instancing, written in place
//! by JS and uploaded to GPU vertex buffers as-is.
//!
//! ```text
//! instance      0                1
//! transforms  [x y z s        | x y z s       ]  f32, s = uniform scale
//! rotations   [qx qy qz qw    | qx qy qz qw   ]  f32, unit quaternion
//! colors      [rgba           | rgba          ]  u32, r | g << 8 | b << 16 | a << 24
//! ```
//!
//! The first `count` instances are drawn. The storage knows nothing about the
//! mesh it is drawn with or what the instances represent.
//!
//! # Zero-copy contract
//!
//! The arrays are allocated once, at full capacity, and never reallocated, so
//! the `*_ptr()` pointers stay valid for the buffer's lifetime. Typed-array
//! views over them still detach when Wasm memory grows (an allocation anywhere
//! in the module); JS must rebuild a view whose `buffer.byteLength` is `0`.

use wasm_bindgen::prelude::*;

use super::sphere_query;
use crate::math::camera::Camera;

pub const FLOATS_PER_TRANSFORM: usize = 4;
pub const FLOATS_PER_ROTATION: usize = 4;

/// Upper bound on the capacity; see `EntityBuffer` for the rationale.
const MAX_CAPACITY: usize = 1 << 22;

const DEFAULT_TRANSFORM: [f32; FLOATS_PER_TRANSFORM] = [0.0, 0.0, 0.0, 1.0];
const IDENTITY_ROTATION: [f32; FLOATS_PER_ROTATION] = [0.0, 0.0, 0.0, 1.0];
const OPAQUE_WHITE: u32 = 0xffff_ffff;

/// Transforms, rotations and colors of up to `capacity` instances.
#[wasm_bindgen]
pub struct InstanceBuffer {
    transforms: Vec<f32>,
    rotations: Vec<f32>,
    colors: Vec<u32>,
    count: usize,
}

#[wasm_bindgen]
impl InstanceBuffer {
    /// Allocates room for `capacity` instances, clamped to `[1, 4_194_304]`.
    /// Every slot starts at the origin with scale `1`, no rotation and opaque
    /// white; the active count starts at `0`.
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> InstanceBuffer {
        let capacity = capacity.clamp(1, MAX_CAPACITY);
        InstanceBuffer {
            transforms: DEFAULT_TRANSFORM.repeat(capacity),
            rotations: IDENTITY_ROTATION.repeat(capacity),
            colors: vec![OPAQUE_WHITE; capacity],
            count: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.colors.len()
    }

    /// Number of instances drawn, always `<= capacity()`.
    pub fn count(&self) -> usize {
        self.count
    }

    /// Sets how many leading instances are active, clamped to the capacity,
    /// and returns the value applied. Slots past the count keep their data.
    pub fn set_count(&mut self, count: usize) -> usize {
        self.count = count.min(self.capacity());
        self.count
    }

    /// `capacity * 4` floats: `[x, y, z, uniform_scale]` per instance.
    pub fn transforms_ptr(&mut self) -> *mut f32 {
        self.transforms.as_mut_ptr()
    }

    /// `capacity * 4` floats: a unit quaternion `[x, y, z, w]` per instance.
    pub fn rotations_ptr(&mut self) -> *mut f32 {
        self.rotations.as_mut_ptr()
    }

    /// `capacity` packed RGBA colors, red in the lowest byte.
    pub fn colors_ptr(&mut self) -> *mut u32 {
        self.colors.as_mut_ptr()
    }

    /// Index of the active instance nearest to the camera under the screen
    /// point `(ndc_x, ndc_y)`, or `-1`. Each instance is a sphere of radius
    /// `|scale| * radius_per_scale` (the base mesh's bounding radius). Reads
    /// the transforms in place: nothing is copied from JS.
    pub fn raycast_ndc(
        &self,
        camera: &Camera,
        ndc_x: f32,
        ndc_y: f32,
        radius_per_scale: f32,
    ) -> i32 {
        sphere_query::raycast_ndc(
            camera,
            ndc_x,
            ndc_y,
            self.active_transforms(),
            FLOATS_PER_TRANSFORM,
            radius_per_scale,
        )
    }

    /// Ascending indices of the active instances whose bounding sphere (as in
    /// `raycast_ndc`) intersects `camera`'s frustum.
    pub fn visible_indices(&self, camera: &Camera, radius_per_scale: f32) -> Vec<u32> {
        sphere_query::visible_indices(
            camera,
            self.active_transforms(),
            FLOATS_PER_TRANSFORM,
            radius_per_scale,
        )
    }
}

impl InstanceBuffer {
    pub fn transforms_slice(&self) -> &[f32] {
        &self.transforms
    }

    pub fn rotations_slice(&self) -> &[f32] {
        &self.rotations
    }

    pub fn colors_slice(&self) -> &[u32] {
        &self.colors
    }

    fn active_transforms(&self) -> &[f32] {
        &self.transforms[..self.count * FLOATS_PER_TRANSFORM]
    }
}

#[cfg(test)]
#[path = "instance_buffer_tests.rs"]
mod tests;
