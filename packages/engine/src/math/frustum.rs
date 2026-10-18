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
mod tests {
    use super::*;
    use crate::math::camera::{Camera, ProjectionMode};

    const TOLERANCE: f32 = 1e-4;

    fn assert_close(actual: &[f32], expected: &[f32]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < TOLERANCE, "expected {expected:?}, got {actual:?}");
        }
    }

    /// Default camera: eye (0, 0, 10) looking at the origin, near 0.1, far 1000.
    /// In `Ortho2D` mode it sees x, y in [-100, 100] when `aspect == 1`.
    fn ortho_frustum() -> Frustum {
        Frustum::from_view_proj(Camera::new(1.0).view_proj())
    }

    fn perspective_frustum() -> Frustum {
        let mut camera = Camera::new(1.0);
        camera.set_mode(ProjectionMode::Perspective3D);
        Frustum::from_view_proj(camera.view_proj())
    }

    #[test]
    fn plane_from_coefficients_normalizes_all_four_components() {
        let plane = Plane::from_coefficients(0.0, 3.0, 4.0, 10.0);

        assert_close(&plane.normal, &[0.0, 0.6, 0.8]);
        assert_close(&[plane.d], &[2.0]);
    }

    #[test]
    fn plane_distance_is_signed() {
        let plane = Plane::from_coefficients(0.0, 1.0, 0.0, -5.0); // y = 5, inside is y > 5

        assert_close(&[plane.distance_to_point([0.0, 8.0, 0.0])], &[3.0]);
        assert_close(&[plane.distance_to_point([0.0, 5.0, 0.0])], &[0.0]);
        assert_close(&[plane.distance_to_point([0.0, 1.0, 0.0])], &[-4.0]);
    }

    #[test]
    fn degenerate_plane_never_culls() {
        let plane = Plane::from_coefficients(0.0, 0.0, 0.0, 7.0);

        assert_eq!(plane.distance_to_point([1.0, 2.0, 3.0]), 0.0);
        assert!(plane.normal.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn ortho_planes_are_axis_aligned_and_face_inward() {
        let [left, right, bottom, top, near, far] = ortho_frustum().planes;

        assert_close(&[left.normal[0], left.d], &[1.0, 100.0]);
        assert_close(&[right.normal[0], right.d], &[-1.0, 100.0]);
        assert_close(&[bottom.normal[1], bottom.d], &[1.0, 100.0]);
        assert_close(&[top.normal[1], top.d], &[-1.0, 100.0]);
        // Eye at z = 10: near plane at z = 9.9 facing -Z, far plane at z = -990 facing +Z.
        assert_close(&[near.normal[2], near.d], &[-1.0, 9.9]);
        assert_close(&[far.normal[2], far.d], &[1.0, 990.0]);
    }

    #[test]
    fn all_plane_normals_are_unit_length() {
        for frustum in [ortho_frustum(), perspective_frustum()] {
            for plane in frustum.planes {
                assert_close(&[dot(plane.normal, plane.normal).sqrt()], &[1.0]);
            }
        }
    }

    #[test]
    fn ortho_keeps_an_entity_at_the_center() {
        assert!(ortho_frustum().contains_entity([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]));
    }

    #[test]
    fn ortho_culls_a_distant_entity() {
        assert!(!ortho_frustum().contains_entity([250.0, 0.0, 0.0], [10.0, 10.0, 1.0]));
    }

    #[test]
    fn ortho_keeps_an_entity_whose_edge_overlaps_the_screen() {
        // Quad spans x in [95, 115]; the screen ends at x = 100, so it is visible.
        assert!(ortho_frustum().contains_entity([105.0, 0.0, 0.0], [20.0, 20.0, 1.0]));
    }

    #[test]
    fn ortho_culls_on_every_side() {
        let frustum = ortho_frustum();
        let scale = [10.0, 10.0, 1.0];

        for pos in [
            [-250.0, 0.0, 0.0],
            [250.0, 0.0, 0.0],
            [0.0, -250.0, 0.0],
            [0.0, 250.0, 0.0],
        ] {
            assert!(!frustum.contains_entity(pos, scale), "{pos:?} should be culled");
        }
    }

    #[test]
    fn ortho_follows_the_camera_when_panned() {
        let mut camera = Camera::new(1.0);
        camera.pan_2d(250.0, 0.0);
        let frustum = Frustum::from_view_proj(camera.view_proj());

        assert!(frustum.contains_entity([250.0, 0.0, 0.0], [10.0, 10.0, 1.0]));
        assert!(!frustum.contains_entity([0.0, 0.0, 0.0], [10.0, 10.0, 1.0]));
    }

    #[test]
    fn ortho_near_plane_uses_the_zero_to_one_depth_range() {
        // z = 9.95 is between the eye (z = 10) and the near plane (z = 9.9),
        // i.e. clip depth < 0. An OpenGL-style `r3 + r2` extraction would keep it.
        assert!(!ortho_frustum().intersects_sphere([0.0, 0.0, 9.95], 0.001));
        assert!(ortho_frustum().intersects_sphere([0.0, 0.0, 9.85], 0.001));
    }

    #[test]
    fn ortho_culls_beyond_the_far_plane() {
        assert!(ortho_frustum().intersects_sphere([0.0, 0.0, -980.0], 1.0));
        assert!(!ortho_frustum().intersects_sphere([0.0, 0.0, -1000.0], 1.0));
    }

    #[test]
    fn perspective_keeps_points_inside_the_view_cone() {
        let frustum = perspective_frustum();

        assert!(frustum.intersects_sphere([0.0, 0.0, 0.0], 0.1));
        assert!(frustum.intersects_sphere([0.0, 0.0, -500.0], 0.1));
        // Half-extent at distance 10 is tan(22.5 degrees) * 10, about 4.14.
        assert!(frustum.intersects_sphere([3.0, 3.0, 0.0], 0.1));
    }

    #[test]
    fn perspective_culls_points_behind_the_camera() {
        let frustum = perspective_frustum();

        assert!(!frustum.intersects_sphere([0.0, 0.0, 20.0], 0.1));
        assert!(!frustum.intersects_sphere([0.0, 0.0, 10.5], 0.1));
    }

    #[test]
    fn perspective_culls_points_beyond_the_far_plane() {
        let frustum = perspective_frustum();

        assert!(!frustum.intersects_sphere([0.0, 0.0, -1100.0], 0.1));
        assert!(frustum.intersects_sphere([0.0, 0.0, -980.0], 0.1));
    }

    #[test]
    fn perspective_culls_points_outside_the_view_cone() {
        let frustum = perspective_frustum();

        assert!(!frustum.intersects_sphere([50.0, 0.0, 0.0], 0.1));
        assert!(!frustum.intersects_sphere([0.0, -50.0, 0.0], 0.1));
        assert!(frustum.intersects_sphere([50.0, 0.0, 0.0], 50.0));
    }

    #[test]
    fn contains_entity_uses_half_the_box_diagonal_as_radius() {
        // Right plane at x = 100. Radius = 0.5 * sqrt(30^2) = 15: center at 114 touches, 116 does not.
        let frustum = ortho_frustum();

        assert!(frustum.contains_entity([114.0, 0.0, 0.0], [30.0, 0.0, 0.0]));
        assert!(!frustum.contains_entity([116.0, 0.0, 0.0], [30.0, 0.0, 0.0]));
    }
}
