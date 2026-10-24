use super::*;
use crate::math::bounding_volume::BoundingVolume;
use crate::math::camera::{Camera, ProjectionMode};

const TOLERANCE: f32 = 1e-4;

fn assert_close(actual: &[f32], expected: &[f32]) {
    for (a, e) in actual.iter().zip(expected) {
        assert!(
            (a - e).abs() < TOLERANCE,
            "expected {expected:?}, got {actual:?}"
        );
    }
}

/// Default camera: eye (0, 0, 10) looking at the origin, near 0.1, far 1000.
/// In `Ortho2D` mode it sees x, y in [-100, 100] when `aspect == 1`.
fn ortho_frustum() -> Frustum {
    Frustum::from_view_proj(Camera::new(1.0).view_proj_mat())
}

fn perspective_frustum() -> Frustum {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    Frustum::from_view_proj(camera.view_proj_mat())
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
        assert!(
            !frustum.contains_entity(pos, scale),
            "{pos:?} should be culled"
        );
    }
}

#[test]
fn ortho_follows_the_camera_when_panned() {
    let mut camera = Camera::new(1.0);
    camera.pan_2d(250.0, 0.0);
    let frustum = Frustum::from_view_proj(camera.view_proj_mat());

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

#[test]
fn contains_sphere_accepts_only_spheres_fully_inside_every_plane() {
    // Ortho camera at z = 10: x, y in [-100, 100], near plane at z = 9.9.
    let frustum = ortho_frustum();

    assert!(frustum.contains_sphere([0.0, 0.0, -100.0], 50.0));
    assert!(
        frustum.contains_sphere([0.0, 0.0, -100.0], 100.0),
        "touching the sides is still inside"
    );
    assert!(
        !frustum.contains_sphere([0.0, 0.0, -100.0], 100.5),
        "pokes out of all four sides"
    );
    assert!(
        !frustum.contains_sphere([80.0, 0.0, -100.0], 30.0),
        "crosses the right plane"
    );
    assert!(
        !frustum.contains_sphere([0.0, 0.0, 9.0], 2.0),
        "crosses the near plane"
    );
}

#[test]
fn contains_sphere_is_stricter_than_intersects_sphere() {
    let frustum = perspective_frustum();
    for (center, radius) in [
        ([0.0, 0.0, -50.0], 5.0),
        ([0.0, 0.0, -50.0], 30.0),
        ([40.0, 0.0, -50.0], 10.0),
        ([0.0, 0.0, -2000.0], 1.0),
    ] {
        if frustum.contains_sphere(center, radius) {
            assert!(
                frustum.intersects_sphere(center, radius),
                "{center:?} r={radius}"
            );
        }
    }
    assert!(frustum.contains_sphere([0.0, 0.0, -50.0], 5.0));
    assert!(!frustum.contains_sphere([0.0, 0.0, -50.0], 30.0));
}

#[test]
fn contains_aabb_accepts_a_flat_2d_scene_whose_sphere_would_bulge_out() {
    // A flat 180 x 180 layer at z = 0, 9.9 units behind the near plane.
    let frustum = ortho_frustum();
    let (min, max) = ([-90.0, -90.0, 0.0], [90.0, 90.0, 0.0]);

    assert!(frustum.contains_aabb(min, max));
    assert!(
        !frustum.contains_sphere([0.0, 0.0, 0.0], 127.3),
        "its bounding sphere crosses near and far"
    );
    assert!(
        !frustum.contains_aabb([-90.0, -90.0, 0.0], [110.0, 90.0, 0.0]),
        "crosses the right plane"
    );
    assert!(
        !frustum.contains_aabb([-1.0, -1.0, 0.0], [1.0, 1.0, 20.0]),
        "crosses the near plane"
    );
}

#[test]
fn contains_volume_accepts_when_either_shape_fits() {
    let frustum = ortho_frustum();
    let flat = BoundingVolume {
        center: [0.0; 3],
        radius: 127.3,
        min: [-90.0, -90.0, 0.0],
        max: [90.0, 90.0, 0.0],
    };
    let round = BoundingVolume {
        center: [0.0, 0.0, -100.0],
        radius: 90.0,
        min: [-90.0, -90.0, -190.0],
        max: [90.0, 90.0, 10.0],
    };
    let too_big = BoundingVolume {
        center: [0.0, 0.0, -100.0],
        radius: 150.0,
        min: [-150.0; 3],
        max: [150.0; 3],
    };

    assert!(frustum.contains_volume(&flat), "box fits");
    assert!(
        frustum.contains_volume(&round),
        "sphere fits (the box pokes through the near plane)"
    );
    assert!(!frustum.contains_volume(&too_big));
}

#[test]
fn trivial_accept_rejects_invalid_input_and_degenerate_planes() {
    let frustum = ortho_frustum();
    assert!(!frustum.contains_sphere([f32::NAN, 0.0, 0.0], 1.0));
    assert!(!frustum.contains_sphere([0.0, 0.0, -100.0], f32::INFINITY));
    assert!(!frustum.contains_sphere([0.0, 0.0, -100.0], -1.0));
    assert!(
        !frustum.contains_aabb([1.0, 0.0, -100.0], [0.0, 0.0, -100.0]),
        "inverted box"
    );
    assert!(!frustum.contains_aabb([f32::NAN, 0.0, 0.0], [1.0, 1.0, 1.0]));

    let degenerate = Frustum::from_view_proj(&Mat4([0.0; 16]));
    assert!(
        !degenerate.contains_sphere([0.0; 3], 0.0),
        "never trivially accept on a broken camera"
    );
    assert!(!degenerate.contains_aabb([0.0; 3], [0.0; 3]));
}

#[test]
fn excludes_sphere_and_aabb_reject_only_volumes_wholly_outside_a_plane() {
    let frustum = ortho_frustum(); // x, y in [-100, 100], eye at z = 10

    assert!(frustum.excludes_sphere([300.0, 0.0, -100.0], 50.0));
    assert!(
        !frustum.excludes_sphere([120.0, 0.0, -100.0], 50.0),
        "pokes into view"
    );
    assert!(
        frustum.excludes_sphere([0.0, 0.0, 50.0], 5.0),
        "behind the near plane"
    );
    assert!(frustum.excludes_aabb([150.0, -10.0, -100.0], [170.0, 10.0, -50.0]));
    assert!(!frustum.excludes_aabb([90.0, -10.0, -100.0], [170.0, 10.0, -50.0]));
}

#[test]
fn classify_volume_covers_accept_reject_and_partial() {
    let frustum = ortho_frustum();
    let volume = |center: [f32; 3], half: f32| BoundingVolume {
        center,
        radius: half * 3.0_f32.sqrt(),
        min: center.map(|c| c - half),
        max: center.map(|c| c + half),
    };

    assert_eq!(
        frustum.classify_volume(&volume([0.0, 0.0, -100.0], 20.0)),
        VolumeVisibility::Visible
    );
    assert_eq!(
        frustum.classify_volume(&volume([400.0, 0.0, -100.0], 20.0)),
        VolumeVisibility::Hidden
    );
    assert_eq!(
        frustum.classify_volume(&volume([100.0, 0.0, -100.0], 20.0)),
        VolumeVisibility::Partial
    );
}

#[test]
fn trivial_reject_never_fires_on_invalid_input_or_a_degenerate_camera() {
    let frustum = ortho_frustum();
    assert!(!frustum.excludes_sphere([f32::NAN, 0.0, 0.0], 1.0));
    assert!(!frustum.excludes_sphere([400.0, 0.0, -100.0], -1.0));
    assert!(!frustum.excludes_aabb([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]));

    let degenerate = Frustum::from_view_proj(&Mat4([0.0; 16]));
    assert!(!degenerate.excludes_sphere([400.0, 0.0, 0.0], 1.0));
    assert!(!degenerate.excludes_aabb([400.0; 3], [401.0; 3]));
}
