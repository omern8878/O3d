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
    let [x, y, z, w] = camera.view_proj_mat().transform_point3(point);
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
    assert!(camera.view_proj_mat().0.iter().all(|v| v.is_finite()));
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
    assert!(camera.view_proj_mat().0.iter().all(|v| v.is_finite()));
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

    assert_eq!(exposed, &camera.view_proj_mat().0);
}

fn assert_finite_matrix(camera: &Camera) {
    assert!(
        camera.view_proj_mat().0.iter().all(|v| v.is_finite()),
        "non-finite view_proj: {:?}",
        camera.view_proj_mat().0
    );
}

const BAD_FLOATS: [f32; 4] = [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, f32::MAX];

#[test]
fn constructor_falls_back_to_a_unit_aspect_for_unusable_values() {
    for aspect in [f32::NAN, f32::INFINITY, 0.0, -2.0, 1.0e-30, f32::MAX] {
        let camera = Camera::new(aspect);

        assert_eq!(camera.aspect(), 1.0, "aspect {aspect}");
        assert_finite_matrix(&camera);
    }
}

#[test]
fn set_aspect_ignores_unusable_values_and_keeps_the_previous_one() {
    let mut camera = Camera::new(2.0);
    let before = *camera.view_proj_mat();

    for aspect in [f32::NAN, f32::INFINITY, 0.0, -1.0, 1.0e-30, f32::MAX] {
        camera.set_aspect(aspect);

        assert_eq!(camera.aspect(), 2.0, "aspect {aspect}");
    }
    assert_eq!(*camera.view_proj_mat(), before);
}

#[test]
fn set_aspect_accepts_the_extreme_but_valid_range() {
    let mut camera = Camera::new(1.0);
    for aspect in [MIN_ASPECT, MAX_ASPECT] {
        camera.set_aspect(aspect);

        assert_eq!(camera.aspect(), aspect);
        assert_finite_matrix(&camera);
        camera.set_mode(ProjectionMode::Perspective3D);
        assert_finite_matrix(&camera);
        camera.set_mode(ProjectionMode::Ortho2D);
    }
}

#[test]
fn set_position_and_target_ignore_invalid_coordinates() {
    let mut camera = Camera::new(1.0);
    let (eye, target) = (camera.eye, camera.target);

    for bad in BAD_FLOATS {
        camera.set_position(bad, 0.0, 0.0);
        camera.set_position(0.0, bad, 0.0);
        camera.set_position(0.0, 0.0, bad);
        camera.set_target(bad, 0.0, 0.0);
        camera.set_target(0.0, bad, 0.0);
        camera.set_target(0.0, 0.0, bad);
    }

    assert_eq!(camera.eye, eye);
    assert_eq!(camera.target, target);
    assert_finite_matrix(&camera);
}

#[test]
fn set_ortho_zoom_ignores_non_finite_and_clamps_huge_values() {
    let mut camera = Camera::new(1.0);
    camera.set_ortho_zoom(50.0);

    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        camera.set_ortho_zoom(bad);
        assert_eq!(camera.ortho_half_height(), 50.0);
    }

    camera.set_ortho_zoom(f32::MAX);
    assert_eq!(camera.ortho_half_height(), MAX_ORTHO_HALF_HEIGHT);
    assert_finite_matrix(&camera);

    camera.set_ortho_zoom(0.0);
    assert_eq!(camera.ortho_half_height(), MIN_ORTHO_HALF_HEIGHT);
    assert_finite_matrix(&camera);
}

#[test]
fn zoom_by_factor_ignores_non_finite_factors_in_both_modes() {
    for mode in [ProjectionMode::Ortho2D, ProjectionMode::Perspective3D] {
        let mut camera = Camera::new(1.0);
        camera.set_mode(mode);
        let (eye, half_height) = (camera.eye, camera.ortho_half_height());

        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            camera.zoom_by_factor(bad);
        }

        assert_eq!(camera.eye, eye);
        assert_eq!(camera.ortho_half_height(), half_height);
        assert_finite_matrix(&camera);
    }
}

#[test]
fn zoom_by_zero_or_a_huge_factor_keeps_the_matrix_finite() {
    for mode in [ProjectionMode::Ortho2D, ProjectionMode::Perspective3D] {
        let mut camera = Camera::new(1.0);
        camera.set_mode(mode);

        for factor in [0.0, -0.0, f32::MIN_POSITIVE, f32::MAX] {
            camera.zoom_by_factor(factor);
            assert_finite_matrix(&camera);
        }
    }
}

#[test]
fn orbit_3d_ignores_non_finite_deltas() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    let eye = camera.eye;

    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        camera.orbit_3d(bad, 0.0);
        camera.orbit_3d(0.0, bad);
    }

    assert_eq!(camera.eye, eye);
    assert_finite_matrix(&camera);
}

#[test]
fn orbit_3d_with_huge_finite_deltas_stays_finite() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    camera.orbit_3d(f32::MAX, f32::MAX);

    assert!(camera.eye.iter().all(|v| v.is_finite()));
    assert_finite_matrix(&camera);
}

#[test]
fn pan_2d_ignores_non_finite_or_out_of_range_deltas() {
    let mut camera = Camera::new(1.0);
    let (eye, target) = (camera.eye, camera.target);

    for bad in BAD_FLOATS {
        camera.pan_2d(bad, 0.0);
        camera.pan_2d(0.0, bad);
    }

    assert_eq!(camera.eye, eye);
    assert_eq!(camera.target, target);
    assert_finite_matrix(&camera);
}

#[test]
fn eye_equal_to_target_keeps_a_finite_usable_matrix_in_both_modes() {
    for mode in [ProjectionMode::Ortho2D, ProjectionMode::Perspective3D] {
        let mut camera = Camera::new(1.0);
        camera.set_mode(mode);
        camera.set_position(3.0, 4.0, 5.0);
        camera.set_target(3.0, 4.0, 5.0);

        assert_finite_matrix(&camera);
        camera.orbit_3d(1.0, 1.0);
        camera.zoom_by_factor(2.0);
        assert_finite_matrix(&camera);
        assert_eq!(camera.eye, [3.0, 4.0, 5.0]);
    }
}

#[test]
fn looking_straight_up_or_down_keeps_a_finite_matrix() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);

    for eye_y in [10.0, -10.0] {
        camera.set_target(0.0, 0.0, 0.0);
        camera.set_position(0.0, eye_y, 0.0);

        assert_finite_matrix(&camera);
        assert_close(&to_clip(&camera, [0.0, 0.0, 0.0])[..2], &[0.0, 0.0]);
    }
}

fn camera_3d_at(eye: [f32; 3]) -> Camera {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    camera.set_position(eye[0], eye[1], eye[2]);
    camera
}

#[test]
fn forward_points_from_the_eye_to_the_target() {
    let camera = camera_3d_at([0.0, 0.0, 10.0]);
    assert_close(&camera.forward(), &[0.0, 0.0, -1.0]);

    let camera = camera_3d_at([3.0, 4.0, 0.0]);
    assert_close(&camera.forward(), &[-0.6, -0.8, 0.0]);
}

#[test]
fn unproject_ndc_returns_a_unit_ray_from_the_near_plane() {
    let camera = camera_3d_at([0.0, 0.0, 10.0]);
    let ray = camera.unproject_ndc(0.0, 0.0);

    assert_eq!(ray.len(), 6);
    assert_close(&ray, &[0.0, 0.0, 9.9, 0.0, 0.0, -1.0]);
    assert!(camera.unproject_ndc(f32::NAN, 0.0).is_empty());
}

#[test]
fn unprojected_ray_passes_through_the_world_point_under_the_cursor() {
    let camera = camera_3d_at([4.0, 3.0, 12.0]);
    let point = [1.5, -2.0, 0.5];
    let ndc = camera
        .view_proj_mat()
        .transform_point3_projective(point)
        .unwrap();
    let ray = camera.unproject_ndc(ndc[0], ndc[1]);

    let to_point = sub(point, [ray[0], ray[1], ray[2]]);
    let along = crate::math::vec3::dot(to_point, [ray[3], ray[4], ray[5]]);
    let closest = add(
        [ray[0], ray[1], ray[2]],
        [ray[3] * along, ray[4] * along, ray[5] * along],
    );
    for (c, p) in closest.iter().zip(point) {
        assert!((c - p).abs() < 1e-3, "{closest:?} vs {point:?}");
    }
}

#[test]
fn disabled_orbit_ignores_orbit_input() {
    let mut camera = camera_3d_at([0.0, 0.0, 10.0]);
    camera.set_orbit_enabled(false);
    camera.orbit_3d(1.0, 0.5);
    assert!(!camera.orbit_enabled());
    assert_close(&camera.forward(), &[0.0, 0.0, -1.0]);

    camera.set_orbit_enabled(true);
    camera.orbit_3d(1.0, 0.0);
    assert!((camera.forward()[0] - -(1.0_f32).sin()).abs() < 1e-5);
}

#[test]
fn locked_angles_ignore_only_their_own_delta() {
    let mut camera = camera_3d_at([0.0, 0.0, 10.0]);
    camera.set_orbit_locks(true, false);
    camera.orbit_3d(1.0, 0.5);
    let forward = camera.forward();
    assert!(
        forward[0].abs() < 1e-5,
        "azimuth must not change: {forward:?}"
    );
    assert!((forward[1] - -(0.5_f32).sin()).abs() < 1e-5);

    camera.set_orbit_locks(false, true);
    camera.orbit_3d(0.0, 0.3);
    assert!((camera.forward()[1] - -(0.5_f32).sin()).abs() < 1e-5);
    assert!(!camera.azimuth_locked() && camera.elevation_locked());
}

#[test]
fn xy_plane_lock_faces_the_plane_and_freezes_orbit() {
    let mut camera = camera_3d_at([6.0, 8.0, 0.0]); // distance 10 from the origin
    camera.lock_to_xy_plane(true);

    assert_close(&camera.forward(), &[0.0, 0.0, -1.0]);
    assert_close(&camera.unproject_ndc(0.0, 0.0)[..3], &[0.0, 0.0, 9.9]);
    camera.orbit_3d(1.0, 1.0);
    assert_close(&camera.forward(), &[0.0, 0.0, -1.0]);

    // Pan and zoom still work while locked.
    camera.zoom_by_factor(0.5);
    assert_close(&camera.unproject_ndc(0.0, 0.0)[..3], &[0.0, 0.0, 4.9]);

    camera.lock_to_xy_plane(false);
    camera.orbit_3d(0.5, 0.0);
    assert!(camera.forward()[0].abs() > 0.1);
}
