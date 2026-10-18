//! View frustum extracted from a view-projection matrix, with bounding-sphere
//! visibility tests for culling.
//!
//! Planes come from the Gribb-Hartmann method, adapted to WebGPU's `[0, 1]`
//! clip-space depth and this crate's column-major, column-vector matrices
//! (`clip = view_proj * point`). A point is inside the frustum when it lies on
//! the positive side of all six planes.

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
            return Plane { normal: [0.0; 3], d: 0.0 };
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
