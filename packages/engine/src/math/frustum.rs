//! View frustum extracted from a view-projection matrix, with bounding-sphere
//! visibility tests for culling.
//!
//! Planes come from the Gribb-Hartmann method, adapted to WebGPU's `[0, 1]`
//! clip-space depth and this crate's column-major, column-vector matrices
//! (`clip = view_proj * point`). A point is inside the frustum when it lies on
//! the positive side of all six planes.

use super::bounding_volume::BoundingVolume;
use super::mat4::Mat4;
use super::vec3::dot;

/// Planes with a normal shorter than this cannot be normalized.
const MIN_NORMAL_LENGTH: f32 = 1e-12;

/// A normalized plane `n . p + d = 0`; the normal points into the frustum.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub normal: [f32; 3],
    pub d: f32,
}

impl Plane {
    /// Builds a plane from `a x + b y + c z + d = 0`, normalizing all four
    /// coefficients by `sqrt(a^2 + b^2 + c^2)`.
    ///
    /// A degenerate plane (zero normal) becomes the zero plane, which every
    /// point is at distance `0` from, so it never culls anything.
    pub fn from_coefficients(a: f32, b: f32, c: f32, d: f32) -> Self {
        let length = (a * a + b * b + c * c).sqrt();
        if length < MIN_NORMAL_LENGTH {
            return Plane {
                normal: [0.0; 3],
                d: 0.0,
            };
        }
        Plane {
            normal: [a / length, b / length, c / length],
            d: d / length,
        }
    }

    /// Signed distance from `point` to the plane: positive on the side the
    /// normal points to (inside the frustum), negative on the other.
    pub fn distance_to_point(&self, point: [f32; 3]) -> f32 {
        dot(self.normal, point) + self.d
    }
}

/// How a bounding volume relates to the frustum, decided in O(1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VolumeVisibility {
    /// Entirely outside: nothing it bounds can be visible (trivial reject).
    Hidden,
    /// Straddles a plane (or cannot be decided): per-entity culling is needed.
    Partial,
    /// Entirely inside: everything it bounds is visible (trivial accept).
    Visible,
}

/// Six inward-facing planes, ordered Left, Right, Bottom, Top, Near, Far.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frustum {
    pub planes: [Plane; 6],
}

impl Frustum {
    /// Extracts the frustum planes from a column-major view-projection matrix
    /// that maps depth to `[0, 1]`.
    ///
    /// With rows `r0..r3` of the matrix, a point is inside when
    /// `-w <= x <= w`, `-w <= y <= w` and `0 <= z <= w` in clip space:
    ///
    /// | Plane  | Coefficients |
    /// |--------|--------------|
    /// | Left   | `r3 + r0`    |
    /// | Right  | `r3 - r0`    |
    /// | Bottom | `r3 + r1`    |
    /// | Top    | `r3 - r1`    |
    /// | Near   | `r2` (`z >= 0`, not OpenGL's `r3 + r2`) |
    /// | Far    | `r3 - r2`    |
    pub fn from_view_proj(vp: &Mat4) -> Self {
        let row = |i: usize| [vp.0[i], vp.0[4 + i], vp.0[8 + i], vp.0[12 + i]];
        let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));

        let plane = |coefficients: [f32; 4]| {
            Plane::from_coefficients(
                coefficients[0],
                coefficients[1],
                coefficients[2],
                coefficients[3],
            )
        };
        let add = |a: [f32; 4], b: [f32; 4]| std::array::from_fn(|i| a[i] + b[i]);
        let subtract = |a: [f32; 4], b: [f32; 4]| std::array::from_fn(|i| a[i] - b[i]);

        Frustum {
            planes: [
                plane(add(r3, r0)),
                plane(subtract(r3, r0)),
                plane(add(r3, r1)),
                plane(subtract(r3, r1)),
                plane(r2),
                plane(subtract(r3, r2)),
            ],
        }
    }

    /// Conservative visibility test: `false` only if the sphere lies entirely
    /// outside at least one plane. It can keep spheres near a frustum corner
    /// that are in fact just outside, but never culls a visible one.
    pub fn intersects_sphere(&self, center: [f32; 3], radius: f32) -> bool {
        self.planes
            .iter()
            .all(|plane| plane.distance_to_point(center) >= -radius)
    }

    /// Trivial-accept test: `true` only if the whole sphere lies inside every
    /// plane (signed distance `>= radius`), so everything it bounds is visible
    /// and per-entity culling can be skipped. Non-finite input and degenerate
    /// (zero-normal) planes give `false`, which falls back to full culling.
    pub fn contains_sphere(&self, center: [f32; 3], radius: f32) -> bool {
        if !radius.is_finite() || radius < 0.0 || !center.iter().all(|c| c.is_finite()) {
            return false;
        }
        self.planes
            .iter()
            .all(|plane| plane.normal != [0.0; 3] && plane.distance_to_point(center) >= radius)
    }

    /// Trivial-accept test for a box: `true` only if all of it lies inside
    /// every plane, i.e. its corner nearest each plane is inside. Non-finite or
    /// inverted boxes and degenerate planes give `false`.
    pub fn contains_aabb(&self, min: [f32; 3], max: [f32; 3]) -> bool {
        let finite = min.iter().chain(&max).all(|v| v.is_finite());
        if !finite || (0..3).any(|axis| min[axis] > max[axis]) {
            return false;
        }
        let center: [f32; 3] = std::array::from_fn(|axis| 0.5 * (min[axis] + max[axis]));
        let half: [f32; 3] = std::array::from_fn(|axis| 0.5 * (max[axis] - min[axis]));
        self.planes.iter().all(|plane| {
            let n = plane.normal;
            let reach = n[0].abs() * half[0] + n[1].abs() * half[1] + n[2].abs() * half[2];
            n != [0.0; 3] && plane.distance_to_point(center) >= reach
        })
    }

    /// Whole-scene trivial accept: the volume's sphere *or* its box lies fully
    /// inside, so every entity it bounds is visible.
    pub fn contains_volume(&self, volume: &BoundingVolume) -> bool {
        self.contains_sphere(volume.center, volume.radius)
            || self.contains_aabb(volume.min, volume.max)
    }

    /// Trivial-reject test: `true` only if the whole sphere lies outside some
    /// plane. Invalid input and degenerate planes never reject.
    pub fn excludes_sphere(&self, center: [f32; 3], radius: f32) -> bool {
        if !radius.is_finite() || radius < 0.0 || !center.iter().all(|c| c.is_finite()) {
            return false;
        }
        self.planes
            .iter()
            .any(|plane| plane.normal != [0.0; 3] && plane.distance_to_point(center) < -radius)
    }

    /// Trivial-reject test for a box: `true` only if even its corner nearest
    /// the inside of some plane is outside it.
    pub fn excludes_aabb(&self, min: [f32; 3], max: [f32; 3]) -> bool {
        let finite = min.iter().chain(&max).all(|v| v.is_finite());
        if !finite || (0..3).any(|axis| min[axis] > max[axis]) {
            return false;
        }
        let center: [f32; 3] = std::array::from_fn(|axis| 0.5 * (min[axis] + max[axis]));
        let half: [f32; 3] = std::array::from_fn(|axis| 0.5 * (max[axis] - min[axis]));
        self.planes.iter().any(|plane| {
            let n = plane.normal;
            let reach = n[0].abs() * half[0] + n[1].abs() * half[1] + n[2].abs() * half[2];
            n != [0.0; 3] && plane.distance_to_point(center) < -reach
        })
    }

    /// Classifies a whole scene's bounding volume in O(1): trivially
    /// visible, trivially hidden, or partial (needs per-entity culling).
    /// Either shape deciding is enough, since both enclose every entity.
    pub fn classify_volume(&self, volume: &BoundingVolume) -> VolumeVisibility {
        if self.contains_volume(volume) {
            VolumeVisibility::Visible
        } else if self.excludes_sphere(volume.center, volume.radius)
            || self.excludes_aabb(volume.min, volume.max)
        {
            VolumeVisibility::Hidden
        } else {
            VolumeVisibility::Partial
        }
    }

    /// Visibility of a unit quad or cube centered at `pos` and stretched by
    /// `scale`, using its bounding sphere (radius = half the box diagonal).
    pub fn contains_entity(&self, pos: [f32; 3], scale: [f32; 3]) -> bool {
        let radius = 0.5 * dot(scale, scale).sqrt();
        self.intersects_sphere(pos, radius)
    }
}

#[cfg(test)]
#[path = "frustum_tests.rs"]
mod tests;
