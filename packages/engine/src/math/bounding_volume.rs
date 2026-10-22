//! Conservative bounds of a whole set of entities (a sphere and a box), for
//! whole-scene frustum tests.
//!
//! Both shapes are kept because each is tight for different scenes: a round
//! cloud fits a sphere (its box corners stick out), a flat 2D scene fits a box
//! (its sphere bulges through the near and far planes).

use super::vec3::{dot, sub};

const FLOATS_PER_VEC3: usize = 3;

/// Floats in the flat layout `[cx, cy, cz, r, min_x, min_y, min_z, max_x, max_y, max_z]`.
pub const BOUNDING_VOLUME_FLOATS: usize = 10;

/// A sphere and an axis-aligned box that each contain every entity's own
/// bounding sphere.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoundingVolume {
    pub center: [f32; 3],
    pub radius: f32,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl BoundingVolume {
    /// Encloses entities given as packed `x y z` positions and `sx sy sz`
    /// scales, each one being a sphere of radius half its scale diagonal (the
    /// sphere the frustum culler tests). Two linear passes: the box, then the
    /// sphere around the box centre.
    ///
    /// Returns `None` for no entities, mismatched slices or any non-finite
    /// value, since such a scene cannot be bounded; callers then fall back to
    /// per-entity culling.
    pub fn enclose_entities(positions: &[f32], scales: &[f32]) -> Option<BoundingVolume> {
        let (positions, _) = positions.as_chunks::<FLOATS_PER_VEC3>();
        let (scales, _) = scales.as_chunks::<FLOATS_PER_VEC3>();
        if positions.is_empty() || positions.len() != scales.len() {
            return None;
        }

        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for (position, scale) in positions.iter().zip(scales) {
            let radius = entity_radius(*scale);
            if !radius.is_finite() || !position.iter().all(|c| c.is_finite()) {
                return None;
            }
            for axis in 0..3 {
                min[axis] = min[axis].min(position[axis] - radius);
                max[axis] = max[axis].max(position[axis] + radius);
            }
        }

        let center = std::array::from_fn(|axis| 0.5 * (min[axis] + max[axis]));
        let radius = positions
            .iter()
            .zip(scales)
            .map(|(position, scale)| {
                let offset = sub(*position, center);
                dot(offset, offset).sqrt() + entity_radius(*scale)
            })
            .fold(0.0_f32, f32::max);
        Some(BoundingVolume {
            center,
            radius,
            min,
            max,
        })
    }

    /// Reads the flat layout, rejecting wrong lengths, non-finite values, a
    /// negative radius or an inverted box.
    pub fn from_slice(values: &[f32]) -> Option<BoundingVolume> {
        if values.len() != BOUNDING_VOLUME_FLOATS || !values.iter().all(|v| v.is_finite()) {
            return None;
        }
        let volume = BoundingVolume {
            center: [values[0], values[1], values[2]],
            radius: values[3],
            min: [values[4], values[5], values[6]],
            max: [values[7], values[8], values[9]],
        };
        let valid = volume.radius >= 0.0 && (0..3).all(|axis| volume.min[axis] <= volume.max[axis]);
        valid.then_some(volume)
    }

    pub fn to_array(&self) -> [f32; BOUNDING_VOLUME_FLOATS] {
        let (c, min, max) = (self.center, self.min, self.max);
        [
            c[0],
            c[1],
            c[2],
            self.radius,
            min[0],
            min[1],
            min[2],
            max[0],
            max[1],
            max[2],
        ]
    }
}

/// Half the scale's diagonal, matching `Frustum::contains_entity`.
fn entity_radius(scale: [f32; 3]) -> f32 {
    0.5 * dot(scale, scale).sqrt()
}

#[cfg(test)]
#[path = "bounding_volume_tests.rs"]
mod tests;
