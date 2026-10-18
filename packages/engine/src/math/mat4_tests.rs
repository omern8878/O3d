use super::*;

const TOLERANCE: f32 = 1e-5;

fn assert_close(actual: &[f32], expected: &[f32]) {
    assert_eq!(actual.len(), expected.len());
    for (a, e) in actual.iter().zip(expected) {
        assert!(
            (a - e).abs() < TOLERANCE,
            "expected {expected:?}, got {actual:?}"
        );
    }
}

fn translation(x: f32, y: f32, z: f32) -> Mat4 {
    let mut m = Mat4::identity();
    m.0[12] = x;
    m.0[13] = y;
    m.0[14] = z;
    m
}

fn scale(s: f32) -> Mat4 {
    let mut m = Mat4::identity();
    m.0[0] = s;
    m.0[5] = s;
    m.0[10] = s;
    m
}

/// Projects a point and performs the perspective divide.
fn project(m: &Mat4, point: [f32; 3]) -> [f32; 3] {
    let [x, y, z, w] = m.transform_point3(point);
    [x / w, y / w, z / w]
}

#[test]
fn identity_leaves_points_unchanged() {
    let point = [3.0, -4.0, 5.0];
    assert_close(
        &Mat4::identity().transform_point3(point),
        &[3.0, -4.0, 5.0, 1.0],
    );
}

#[test]
fn identity_multiplication_leaves_matrices_unchanged() {
    let m = translation(1.0, 2.0, 3.0);
    assert_eq!(Mat4::identity().multiply(&m), m);
    assert_eq!(m.multiply(&Mat4::identity()), m);
}

#[test]
fn translation_lives_in_the_last_column() {
    let m = translation(1.0, 2.0, 3.0);
    assert_close(&m.0[12..16], &[1.0, 2.0, 3.0, 1.0]);
    assert_close(&m.transform_point3([0.0, 0.0, 0.0]), &[1.0, 2.0, 3.0, 1.0]);
}

#[test]
fn multiply_applies_the_right_hand_matrix_first() {
    let point = [1.0, 1.0, 1.0];
    let scale_then_translate = translation(10.0, 0.0, 0.0).multiply(&scale(2.0));
    let translate_then_scale = scale(2.0).multiply(&translation(10.0, 0.0, 0.0));

    assert_close(
        &scale_then_translate.transform_point3(point),
        &[12.0, 2.0, 2.0, 1.0],
    );
    assert_close(
        &translate_then_scale.transform_point3(point),
        &[22.0, 2.0, 2.0, 1.0],
    );
}

#[test]
fn orthographic_maps_center_to_origin() {
    let m = Mat4::orthographic_rh_zo(-200.0, 200.0, -100.0, 100.0, 0.1, 1000.0);
    let [x, y, _, w] = m.transform_point3([0.0, 0.0, -1.0]);

    assert_close(&[x, y, w], &[0.0, 0.0, 1.0]);
}

#[test]
fn orthographic_maps_near_and_far_to_zero_and_one() {
    let (near, far) = (0.1, 1000.0);
    let m = Mat4::orthographic_rh_zo(-1.0, 1.0, -1.0, 1.0, near, far);

    assert_close(&[project(&m, [0.0, 0.0, -near])[2]], &[0.0]);
    assert_close(&[project(&m, [0.0, 0.0, -far])[2]], &[1.0]);
}

#[test]
fn orthographic_maps_bounds_to_unit_square() {
    let m = Mat4::orthographic_rh_zo(-200.0, 200.0, -100.0, 100.0, 0.1, 1000.0);

    assert_close(&project(&m, [-200.0, -100.0, -1.0])[..2], &[-1.0, -1.0]);
    assert_close(&project(&m, [200.0, 100.0, -1.0])[..2], &[1.0, 1.0]);
}

#[test]
fn perspective_maps_near_and_far_to_zero_and_one() {
    let (near, far) = (0.1, 1000.0);
    let m = Mat4::perspective_rh_zo(std::f32::consts::FRAC_PI_4, 1.5, near, far);

    assert_close(&[project(&m, [0.0, 0.0, -near])[2]], &[0.0]);
    assert_close(&[project(&m, [0.0, 0.0, -far])[2]], &[1.0]);
}

#[test]
fn perspective_stores_negative_view_depth_in_w() {
    let m = Mat4::perspective_rh_zo(std::f32::consts::FRAC_PI_2, 1.0, 0.1, 100.0);
    let [x, y, _, w] = m.transform_point3([0.0, 0.0, -5.0]);

    assert_close(&[x, y, w], &[0.0, 0.0, 5.0]);
}

#[test]
fn perspective_with_90_degree_fov_maps_the_frustum_edge_to_one() {
    let m = Mat4::perspective_rh_zo(std::f32::consts::FRAC_PI_2, 1.0, 0.1, 100.0);

    assert_close(&project(&m, [5.0, 5.0, -5.0])[..2], &[1.0, 1.0]);
}

#[test]
fn look_at_moves_the_eye_to_the_origin_looking_down_negative_z() {
    let view = Mat4::look_at_rh([0.0, 0.0, 10.0], [0.0, 0.0, 0.0], [0.0, 1.0, 0.0]);

    assert_close(
        &view.transform_point3([0.0, 0.0, 10.0]),
        &[0.0, 0.0, 0.0, 1.0],
    );
    assert_close(
        &view.transform_point3([0.0, 0.0, 0.0]),
        &[0.0, 0.0, -10.0, 1.0],
    );
}

#[test]
fn look_at_keeps_world_axes_for_a_camera_on_the_z_axis() {
    let view = Mat4::look_at_rh([0.0, 0.0, 10.0], [0.0, 0.0, 0.0], [0.0, 1.0, 0.0]);

    assert_close(
        &view.transform_point3([1.0, 0.0, 10.0]),
        &[1.0, 0.0, 0.0, 1.0],
    );
    assert_close(
        &view.transform_point3([0.0, 1.0, 10.0]),
        &[0.0, 1.0, 0.0, 1.0],
    );
}

#[test]
fn look_at_rotates_the_view_for_an_off_axis_eye() {
    // Camera on +X looking at the origin: world -X is straight ahead.
    let view = Mat4::look_at_rh([5.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 1.0, 0.0]);

    assert_close(
        &view.transform_point3([0.0, 0.0, 0.0]),
        &[0.0, 0.0, -5.0, 1.0],
    );
    // The camera's right-hand side is world -Z, which is +X in view space.
    assert_close(
        &view.transform_point3([5.0, 0.0, -1.0]),
        &[1.0, 0.0, 0.0, 1.0],
    );
}

#[test]
fn look_at_degenerate_input_stays_finite() {
    let view = Mat4::look_at_rh([1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [0.0, 1.0, 0.0]);

    assert!(view.0.iter().all(|v| v.is_finite()));
}
