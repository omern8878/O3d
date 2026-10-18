use super::*;
use crate::math::camera::{Camera, ProjectionMode};

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

fn assert_orthonormal_view(view: &Mat4) {
    let column = |c: usize| [view.0[c], view.0[4 + c], view.0[8 + c]];
    let (right, up, back) = (column(0), column(1), column(2));

    for axis in [right, up, back] {
        assert_close(&[dot(axis, axis)], &[1.0]);
    }
    assert_close(
        &[dot(right, up), dot(up, back), dot(right, back)],
        &[0.0; 3],
    );
}

#[test]
fn look_at_with_eye_on_target_looks_down_negative_z_with_a_valid_basis() {
    let view = Mat4::look_at_rh([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], [0.0, 1.0, 0.0]);

    assert_orthonormal_view(&view);
    assert_close(&view.transform_point3([1.0, 2.0, 3.0])[..3], &[0.0; 3]);
}

#[test]
fn look_at_with_up_parallel_to_the_view_direction_keeps_a_valid_basis() {
    for eye_y in [10.0, -10.0] {
        let view = Mat4::look_at_rh([0.0, eye_y, 0.0], [0.0; 3], [0.0, 1.0, 0.0]);

        assert_orthonormal_view(&view);
    }
}

#[test]
fn look_at_with_a_zero_up_vector_keeps_a_valid_basis() {
    let view = Mat4::look_at_rh([0.0, 0.0, 10.0], [0.0; 3], [0.0; 3]);

    assert_orthonormal_view(&view);
}

/// Projection matrices mix entries from 1e-3 to 1e3, so f32 rounding alone
/// leaves ~1e-4 of error; a wrong inverse is off by O(1).
const IDENTITY_TOLERANCE: f32 = 1e-3;

fn assert_identity(m: &Mat4) {
    for (i, (actual, expected)) in m.0.iter().zip(Mat4::identity().0).enumerate() {
        assert!(
            (actual - expected).abs() < IDENTITY_TOLERANCE,
            "element {i}: expected {expected}, got {actual} in {:?}",
            m.0
        );
    }
}

fn camera_view_proj(mode: ProjectionMode) -> Mat4 {
    let mut camera = Camera::new(16.0 / 9.0);
    camera.set_mode(mode);
    camera.set_position(3.0, 4.0, 10.0);
    camera.set_target(1.0, -2.0, 0.0);
    *camera.view_proj_mat()
}

#[test]
fn inverse_of_the_identity_is_the_identity() {
    assert_eq!(Mat4::identity().inverse(), Some(Mat4::identity()));
}

#[test]
fn inverse_undoes_an_ortho2d_camera_view_proj() {
    let view_proj = camera_view_proj(ProjectionMode::Ortho2D);
    let inverse = view_proj.inverse().expect("ortho view_proj is invertible");

    assert_identity(&view_proj.multiply(&inverse));
    assert_identity(&inverse.multiply(&view_proj));
}

#[test]
fn inverse_undoes_a_perspective3d_camera_view_proj() {
    let view_proj = camera_view_proj(ProjectionMode::Perspective3D);
    let inverse = view_proj
        .inverse()
        .expect("perspective view_proj is invertible");

    assert_identity(&view_proj.multiply(&inverse));
    assert_identity(&inverse.multiply(&view_proj));
}

#[test]
fn inverse_of_a_translation_negates_it() {
    let inverse = translation(1.0, -2.0, 3.0).inverse().unwrap();

    assert_close(&inverse.0, &translation(-1.0, 2.0, -3.0).0);
}

#[test]
fn inverse_of_a_scale_is_the_reciprocal_scale() {
    let inverse = scale(4.0).inverse().unwrap();

    assert_close(&[inverse.0[0]], &[0.25]);
}

#[test]
fn inverse_of_an_inverse_returns_the_original() {
    let original = camera_view_proj(ProjectionMode::Perspective3D);
    let round_trip = original.inverse().unwrap().inverse().unwrap();

    for (a, b) in round_trip.0.iter().zip(original.0) {
        let allowed = IDENTITY_TOLERANCE * b.abs().max(1.0);
        assert!((a - b).abs() < allowed, "{a} vs {b}");
    }
}

#[test]
fn inverse_of_an_asymmetric_matrix_is_exact_in_both_orders() {
    let m = Mat4([
        2.0, 0.0, 1.0, 0.0, //
        1.0, 3.0, 0.0, 0.0, //
        0.0, 1.0, 4.0, 0.0, //
        5.0, -6.0, 7.0, 1.0,
    ]);
    let inverse = m.inverse().unwrap();

    assert_identity(&m.multiply(&inverse));
    assert_identity(&inverse.multiply(&m));
}

#[test]
fn singular_matrices_have_no_inverse() {
    assert_eq!(Mat4([0.0; 16]).inverse(), None);

    let mut flat = Mat4::identity();
    flat.0[5] = 0.0; // collapses the Y axis
    assert_eq!(flat.inverse(), None);

    let duplicated_rows = Mat4([
        1.0, 1.0, 0.0, 0.0, //
        2.0, 2.0, 0.0, 0.0, //
        3.0, 3.0, 1.0, 0.0, //
        4.0, 4.0, 0.0, 1.0,
    ]);
    assert_eq!(duplicated_rows.inverse(), None);
}

#[test]
fn nearly_singular_and_non_finite_matrices_have_no_inverse() {
    let mut tiny = Mat4::identity();
    tiny.0[0] = 1e-13;
    assert_eq!(tiny.inverse(), None);

    for bad in [f32::NAN, f32::INFINITY] {
        let mut m = Mat4::identity();
        m.0[7] = bad;
        assert_eq!(m.inverse(), None, "{bad}");
    }
}

#[test]
fn projective_transform_divides_by_w() {
    let mut half_w = Mat4::identity();
    half_w.0[15] = 2.0;

    assert_eq!(
        half_w.transform_point3_projective([4.0, 6.0, 8.0]),
        Some([2.0, 3.0, 4.0])
    );
}

#[test]
fn projective_transform_matches_the_homogeneous_result_for_a_camera() {
    let view_proj = camera_view_proj(ProjectionMode::Perspective3D);
    let point = [1.0, -2.0, 0.0];
    let [x, y, z, w] = view_proj.transform_point3(point);

    assert_close(
        &view_proj.transform_point3_projective(point).unwrap(),
        &[x / w, y / w, z / w],
    );
}

#[test]
fn projective_transform_rejects_a_zero_or_non_finite_w() {
    let mut zero_w = Mat4::identity();
    zero_w.0[15] = 0.0;
    assert_eq!(zero_w.transform_point3_projective([1.0, 2.0, 3.0]), None);

    let mut tiny_w = Mat4::identity();
    tiny_w.0[15] = 1e-13;
    assert_eq!(tiny_w.transform_point3_projective([1.0, 2.0, 3.0]), None);

    assert_eq!(
        Mat4::identity().transform_point3_projective([f32::NAN, 0.0, 0.0]),
        None
    );
}

#[test]
fn unprojecting_a_projected_point_round_trips() {
    for mode in [ProjectionMode::Ortho2D, ProjectionMode::Perspective3D] {
        let view_proj = camera_view_proj(mode);
        let inverse = view_proj.inverse().unwrap();
        let point = [2.0, 1.0, -3.0];

        let ndc = view_proj.transform_point3_projective(point).unwrap();
        let back = inverse.transform_point3_projective(ndc).unwrap();

        for (a, b) in back.iter().zip(point) {
            assert!((a - b).abs() < 1e-2, "{back:?} vs {point:?}");
        }
    }
}
