//! Ray picking and frustum culling over flat arrays of bounding spheres.
//!
//! A sphere array holds `stride` floats per sphere: the first three are the
//! center and the fourth a radius-like value that is multiplied by
//! `radius_scale` (so `[x, y, z, r]` with scale `1.0`, or an instance's
//! `[x, y, z, uniform_scale]` with the base mesh's bounding radius).

use wasm_bindgen::prelude::*;

use crate::math::camera::Camera;
use crate::math::frustum::Frustum;
use crate::math::ray::Ray;

/// Floats per sphere in the `[x, y, z, r]` layout.
pub const FLOATS_PER_SPHERE: usize = 4;

/// Returned when no sphere is under the point.
pub const NO_HIT: i32 = -1;

/// Index of the sphere nearest to the camera under the screen point
/// `(ndc_x, ndc_y)` (`[-1, 1]`, `+Y` up), or `-1` if none is hit.
///
/// `spheres` is a flat `[x, y, z, r, x, y, z, r, ...]` array; a trailing
/// partial sphere is ignored. Ties go to the lower index. Non-finite
/// coordinates and a non-invertible camera give `-1`.
#[wasm_bindgen]
pub fn raycast_spheres_ndc(camera: &Camera, ndc_x: f32, ndc_y: f32, spheres: &[f32]) -> i32 {
    raycast_ndc(camera, ndc_x, ndc_y, spheres, FLOATS_PER_SPHERE, 1.0)
}

/// Indices of the spheres in the flat `[x, y, z, r]` array `spheres` that
/// intersect `camera`'s frustum, in ascending order. Conservative: it may keep
/// a sphere just outside a frustum corner, but never drops a visible one.
#[wasm_bindgen]
pub fn cull_spheres(camera: &Camera, spheres: &[f32]) -> Vec<u32> {
    visible_indices(camera, spheres, FLOATS_PER_SPHERE, 1.0)
}

/// Strided ray pick shared by the free function and the batch types.
pub(crate) fn raycast_ndc(
    camera: &Camera,
    ndc_x: f32,
    ndc_y: f32,
    spheres: &[f32],
    stride: usize,
    radius_scale: f32,
) -> i32 {
    camera
        .ray_through_ndc(ndc_x, ndc_y)
        .and_then(|ray| nearest_hit(&ray, spheres, stride, radius_scale))
        .and_then(|index| i32::try_from(index).ok())
        .unwrap_or(NO_HIT)
}

/// Strided frustum cull shared by the free function and the batch types.
/// A non-finite or negative `radius_scale` keeps nothing.
pub(crate) fn visible_indices(
    camera: &Camera,
    spheres: &[f32],
    stride: usize,
    radius_scale: f32,
) -> Vec<u32> {
    if !radius_scale.is_finite() || radius_scale < 0.0 {
        return Vec::new();
    }
    let frustum = Frustum::from_view_proj(camera.view_proj_mat());
    spheres
        .chunks_exact(stride)
        .enumerate()
        .filter_map(|(index, sphere)| {
            let center = [sphere[0], sphere[1], sphere[2]];
            let radius = sphere[3].abs() * radius_scale;
            let finite = radius.is_finite() && center.iter().all(|c| c.is_finite());
            (finite && frustum.intersects_sphere(center, radius)).then_some(index as u32)
        })
        .collect()
}

/// Index of the sphere the ray enters first.
fn nearest_hit(ray: &Ray, spheres: &[f32], stride: usize, radius_scale: f32) -> Option<usize> {
    let mut best: Option<(usize, f32)> = None;
    for (index, sphere) in spheres.chunks_exact(stride).enumerate() {
        let radius = sphere[3].abs() * radius_scale;
        let Some(distance) = ray.intersect_sphere([sphere[0], sphere[1], sphere[2]], radius) else {
            continue;
        };
        if best.is_none_or(|(_, best_distance)| distance < best_distance) {
            best = Some((index, distance));
        }
    }
    best.map(|(index, _)| index)
}

#[cfg(test)]
#[path = "sphere_query_tests.rs"]
mod tests;
