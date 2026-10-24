//! Mouse / touch picking: finds the entity under a screen point.

use wasm_bindgen::prelude::*;

use super::entity_buffer::EntityBuffer;
use crate::math::camera::Camera;
use crate::math::ray::Ray;

const FLOATS_PER_VEC3: usize = 3;

/// Returned by `pick_ndc` when no entity is under the point.
const NO_ENTITY: i32 = -1;

/// Fraction of an entity's largest scale used as its picking radius. Half the
/// largest extent is the sphere inscribed in the entity's box, so picking
/// never reports an entity the cursor is clearly outside of.
const PICK_RADIUS_PER_SCALE: f32 = 0.5;

/// Casts rays through the scene and reports which entity they hit first.
///
/// Stateless: every call reads the buffer and camera it is given.
#[wasm_bindgen]
#[derive(Default)]
pub struct ScenePicker {}

#[wasm_bindgen]
impl ScenePicker {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ScenePicker {
        ScenePicker {}
    }

    /// The stable ID of the entity nearest to the camera under the screen
    /// point `(ndc_x, ndc_y)` (`[-1, 1]`, `+Y` up), or `-1` if there is none.
    ///
    /// Each entity is a sphere of radius `0.5 * max(scale)` around its
    /// position. Ties go to the entity with the lower dense index. Non-finite
    /// coordinates and a non-invertible camera also give `-1`.
    pub fn pick_ndc(&self, buffer: &EntityBuffer, camera: &Camera, ndc_x: f32, ndc_y: f32) -> i32 {
        let Some(ray) = camera.ray_through_ndc(ndc_x, ndc_y) else {
            return NO_ENTITY;
        };

        Self::nearest_hit(buffer, &ray)
            .and_then(|dense_index| buffer.entity_id_at_dense(dense_index))
            .and_then(|entity_id| i32::try_from(entity_id).ok())
            .unwrap_or(NO_ENTITY)
    }
}

impl ScenePicker {
    /// Dense index of the entity the ray reaches first.
    fn nearest_hit(buffer: &EntityBuffer, ray: &Ray) -> Option<usize> {
        let (positions, _) = buffer.positions_slice().as_chunks::<FLOATS_PER_VEC3>();
        let (scales, _) = buffer.scales_slice().as_chunks::<FLOATS_PER_VEC3>();

        let mut best: Option<(usize, f32)> = None;
        for (dense_index, (&center, &scale)) in positions.iter().zip(scales).enumerate() {
            let Some(radius) = Self::pick_radius(scale) else {
                continue;
            };
            let Some(distance) = ray.intersect_sphere(center, radius) else {
                continue;
            };
            if best.is_none_or(|(_, best_distance)| distance < best_distance) {
                best = Some((dense_index, distance));
            }
        }
        best.map(|(dense_index, _)| dense_index)
    }

    /// `None` for a non-finite scale, which makes the entity unpickable.
    fn pick_radius(scale: [f32; 3]) -> Option<f32> {
        if !scale.iter().all(|s| s.is_finite()) {
            return None;
        }
        let largest = scale.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
        Some(PICK_RADIUS_PER_SCALE * largest)
    }
}

#[cfg(test)]
#[path = "picker_tests.rs"]
mod tests;
