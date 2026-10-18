use super::*;

const TOLERANCE: f32 = 1e-5;

fn assert_close(actual: &[f32], expected: &[f32]) {
    for (a, e) in actual.iter().zip(expected) {
        assert!(
            (a - e).abs() < TOLERANCE,
            "expected {expected:?}, got {actual:?}"
        );
    }
}

/// World point -> normalized device coordinates.
fn to_clip(camera: &Camera, point: [f32; 3]) -> [f32; 3] {
    let [x, y, z, w] = camera.view_proj().transform_point3(point);
    [x / w, y / w, z / w]
}

#[test]
fn defaults_to_an_ortho_camera_centered_on_the_origin() {
    let camera = Camera::new(2.0);

    assert_close(&to_clip(&camera, [0.0, 0.0, 0.0])[..2], &[0.0, 0.0]);
}

#[test]
fn ortho_maps_the_visible_extent_to_the_unit_square() {
    // half_height 100, aspect 2 -> visible area is 200 x 100 around the eye.
    let camera = Camera::new(2.0);

    assert_close(&to_clip(&camera, [200.0, 100.0, 0.0])[..2], &[1.0, 1.0]);
    assert_close(&to_clip(&camera, [-200.0, -100.0, 0.0])[..2], &[-1.0, -1.0]);
    assert_close(&to_clip(&camera, [100.0, 0.0, 0.0])[..2], &[0.5, 0.0]);
}

#[test]
fn ortho_depth_of_the_2d_plane_is_inside_zero_to_one() {
    let camera = Camera::new(1.0);
    let depth = to_clip(&camera, [0.0, 0.0, 0.0])[2];

    assert!((0.0..=1.0).contains(&depth), "depth {depth} outside [0, 1]");
}

#[test]
fn pan_2d_moves_the_view_so_the_new_center_maps_to_the_origin() {
    let mut camera = Camera::new(1.0);
    camera.pan_2d(10.0, 5.0);

    assert_close(&to_clip(&camera, [10.0, 5.0, 0.0])[..2], &[0.0, 0.0]);
    // The old center is now off to the lower-left: 10/100 and 5/100 of the view.
    assert_close(&to_clip(&camera, [0.0, 0.0, 0.0])[..2], &[-0.1, -0.05]);
}

#[test]
fn pan_2d_accumulates() {
    let mut camera = Camera::new(1.0);
    camera.pan_2d(3.0, 0.0);
    camera.pan_2d(-1.0, 4.0);

    assert_close(&to_clip(&camera, [2.0, 4.0, 0.0])[..2], &[0.0, 0.0]);
}

#[test]
fn ortho_zoom_scales_the_visible_area_and_is_clamped() {
    let mut camera = Camera::new(1.0);
    camera.set_ortho_zoom(50.0);
    assert_close(&to_clip(&camera, [50.0, 50.0, 0.0])[..2], &[1.0, 1.0]);

    camera.set_ortho_zoom(-5.0);
    assert!(camera.view_proj().0.iter().all(|v| v.is_finite()));
    assert_close(&to_clip(&camera, [0.0001, 0.0, 0.0])[..1], &[1.0]);
}

#[test]
fn set_aspect_rescales_the_horizontal_extent() {
    let mut camera = Camera::new(1.0);
    camera.set_aspect(2.0);

    assert_close(&to_clip(&camera, [200.0, 0.0, 0.0])[..1], &[1.0]);
}

#[test]
fn perspective_mode_centers_the_target_with_depth_in_range() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    let [x, y, depth] = to_clip(&camera, [0.0, 0.0, 0.0]);

    assert_close(&[x, y], &[0.0, 0.0]);
    assert!((0.0..=1.0).contains(&depth), "depth {depth} outside [0, 1]");
}

#[test]
fn setters_recompute_the_view_projection() {
    let mut camera = Camera::new(1.0);
    camera.set_position(5.0, 0.0, 10.0);
    camera.set_target(5.0, 0.0, 0.0);

    assert_close(&to_clip(&camera, [5.0, 0.0, 0.0])[..2], &[0.0, 0.0]);
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
}

#[test]
fn orbit_3d_preserves_the_distance_to_the_target() {
    let mut camera = Camera::new(1.0);
    camera.set_target(1.0, 2.0, 3.0);
    camera.set_position(4.0, 6.0, 15.0);
    let radius = distance(camera.eye, camera.target);

    camera.orbit_3d(0.7, 0.3);
    camera.orbit_3d(-2.0, -0.4);

    assert!((distance(camera.eye, camera.target) - radius).abs() < 1e-4);
}

#[test]
fn orbit_3d_quarter_turn_moves_the_eye_from_plus_z_to_plus_x() {
    let mut camera = Camera::new(1.0);

    camera.orbit_3d(FRAC_PI_2, 0.0);

    assert_close(&camera.eye, &[10.0, 0.0, 0.0]);
}

#[test]
fn orbit_3d_clamps_elevation_short_of_the_poles() {
    let mut camera = Camera::new(1.0);

    camera.orbit_3d(0.0, 10.0);
    let up = sub(camera.eye, camera.target)[1] / distance(camera.eye, camera.target);
    assert!((up - MAX_ORBIT_ELEVATION.sin()).abs() < 1e-5);
    assert!(up < 1.0);

    camera.orbit_3d(0.0, -100.0);
    let down = sub(camera.eye, camera.target)[1] / distance(camera.eye, camera.target);
    assert!((down + MAX_ORBIT_ELEVATION.sin()).abs() < 1e-5);
    assert!(camera.view_proj().0.iter().all(|v| v.is_finite()));
}

#[test]
fn orbit_3d_with_the_eye_on_the_target_does_nothing() {
    let mut camera = Camera::new(1.0);
    camera.set_position(0.0, 0.0, 0.0);
    camera.orbit_3d(1.0, 1.0);

    assert_eq!(camera.eye, [0.0, 0.0, 0.0]);
}

#[test]
fn zoom_by_factor_scales_the_ortho_half_height() {
    let mut camera = Camera::new(1.0);

    camera.zoom_by_factor(0.5);
    assert_close(&[camera.ortho_half_height()], &[50.0]);

    camera.zoom_by_factor(4.0);
    assert_close(&[camera.ortho_half_height()], &[200.0]);
}

#[test]
fn zoom_by_factor_clamps_non_positive_factors() {
    let mut camera = Camera::new(1.0);
    camera.zoom_by_factor(-3.0);

    assert_close(&[camera.ortho_half_height()], &[100.0 * MIN_ZOOM_FACTOR]);
}

#[test]
fn zoom_by_factor_scales_the_perspective_distance() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);

    camera.zoom_by_factor(2.0);
    assert_close(&[distance(camera.eye, camera.target)], &[20.0]);
    assert_close(&[camera.ortho_half_height()], &[100.0]);

    camera.zoom_by_factor(0.25);
    assert_close(&[distance(camera.eye, camera.target)], &[5.0]);
}

#[test]
fn perspective_zoom_is_limited_by_near_and_far() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);

    camera.zoom_by_factor(MIN_ZOOM_FACTOR);
    assert_close(&[distance(camera.eye, camera.target)], &[0.2]);

    camera.zoom_by_factor(1.0e9);
    assert_close(&[distance(camera.eye, camera.target)], &[900.0]);
}

#[test]
fn getters_report_current_settings() {
    let mut camera = Camera::new(1.5);
    camera.set_ortho_zoom(40.0);

    assert_close(&[camera.aspect(), camera.ortho_half_height()], &[1.5, 40.0]);
}

#[test]
fn view_proj_ptr_exposes_the_sixteen_floats_of_the_matrix() {
    let camera = Camera::new(1.0);
    let exposed = unsafe { std::slice::from_raw_parts(camera.view_proj_ptr(), 16) };

    assert_eq!(exposed, &camera.view_proj().0);
}
