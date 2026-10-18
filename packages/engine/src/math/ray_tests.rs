use super::*;
use crate::math::camera::{Camera, ProjectionMode};

const TOLERANCE: f32 = 1e-3;

fn assert_close(actual: &[f32], expected: &[f32]) {
    assert_eq!(actual.len(), expected.len());
    for (a, e) in actual.iter().zip(expected) {
        assert!(
            (a - e).abs() < TOLERANCE,
            "expected {expected:?}, got {actual:?}"
        );
    }
}

fn inverse_view_proj(camera: &Camera) -> Mat4 {
    camera.view_proj_mat().inverse().unwrap()
}

fn ray_along_negative_z(origin: [f32; 3]) -> Ray {
    Ray {
        origin,
        direction: [0.0, 0.0, -1.0],
    }
}

#[test]
fn ortho_center_ray_starts_on_the_near_plane_and_looks_down_negative_z() {
    // Camera at z = 10, near = 0.1: the near plane is at z = 9.9.
    let camera = Camera::new(1.0);
    let ray = Ray::from_ndc(0.0, 0.0, &inverse_view_proj(&camera)).unwrap();

    assert_close(&ray.origin, &[0.0, 0.0, 9.9]);
    assert_close(&ray.direction, &[0.0, 0.0, -1.0]);
}

#[test]
fn ortho_rays_are_parallel_and_offset_by_the_ndc_position() {
    // half_height 100, aspect 2: ndc (1, 0.5) -> world (200, 50).
    let camera = Camera::new(2.0);
    let ray = Ray::from_ndc(1.0, 0.5, &inverse_view_proj(&camera)).unwrap();

    assert_close(&ray.origin[..2], &[200.0, 50.0]);
    assert_close(&ray.direction, &[0.0, 0.0, -1.0]);
}

#[test]
fn ndc_y_is_up() {
    let camera = Camera::new(1.0);
    let top = Ray::from_ndc(0.0, 1.0, &inverse_view_proj(&camera)).unwrap();
    let bottom = Ray::from_ndc(0.0, -1.0, &inverse_view_proj(&camera)).unwrap();

    assert!(top.origin[1] > 0.0 && bottom.origin[1] < 0.0);
}

#[test]
fn perspective_rays_originate_at_the_eye_side_and_fan_out() {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    let inverse = inverse_view_proj(&camera);

    let center = Ray::from_ndc(0.0, 0.0, &inverse).unwrap();
    let right = Ray::from_ndc(0.5, 0.0, &inverse).unwrap();

    assert_close(&center.direction, &[0.0, 0.0, -1.0]);
    assert!(right.direction[0] > 0.0, "off-center ray leans outward");
    assert_close(&[dot(right.direction, right.direction)], &[1.0]);
    // Near plane is 0.1 in front of the eye at z = 10.
    assert_close(&[center.origin[2]], &[9.9]);
}

#[test]
fn ray_passes_through_the_point_that_projects_to_the_ndc() {
    let mut camera = Camera::new(1.5);
    camera.set_mode(ProjectionMode::Perspective3D);
    camera.set_position(4.0, 3.0, 12.0);
    camera.set_target(0.0, 0.0, 0.0);
    let world = [2.0, -1.0, 1.0];
    let ndc = camera
        .view_proj_mat()
        .transform_point3_projective(world)
        .unwrap();

    let ray = Ray::from_ndc(ndc[0], ndc[1], &inverse_view_proj(&camera)).unwrap();

    assert!(ray.intersect_sphere(world, 0.05).is_some());
}

#[test]
fn non_finite_ndc_gives_no_ray() {
    let inverse = Mat4::identity();

    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(Ray::from_ndc(bad, 0.0, &inverse), None);
        assert_eq!(Ray::from_ndc(0.0, bad, &inverse), None);
    }
}

#[test]
fn a_degenerate_unprojection_gives_no_ray() {
    // Near and far collapse to the same world point.
    let mut flatten_depth = Mat4::identity();
    flatten_depth.0[10] = 0.0;

    assert_eq!(Ray::from_ndc(0.2, 0.3, &flatten_depth), None);
}

#[test]
fn a_matrix_with_zero_w_gives_no_ray() {
    let mut zero_w = Mat4::identity();
    zero_w.0[15] = 0.0;

    assert_eq!(Ray::from_ndc(0.0, 0.0, &zero_w), None);
}

#[test]
fn sphere_hit_returns_the_distance_to_the_near_surface() {
    let ray = ray_along_negative_z([0.0, 0.0, 10.0]);

    assert_close(
        &[ray.intersect_sphere([0.0, 0.0, 0.0], 2.0).unwrap()],
        &[8.0],
    );
}

#[test]
fn sphere_miss_returns_none() {
    let ray = ray_along_negative_z([0.0, 0.0, 10.0]);

    assert_eq!(ray.intersect_sphere([5.0, 0.0, 0.0], 2.0), None);
}

#[test]
fn glancing_ray_hits_a_tangent_sphere_once() {
    let ray = ray_along_negative_z([2.0, 0.0, 10.0]);

    assert_close(
        &[ray.intersect_sphere([0.0, 0.0, 0.0], 2.0).unwrap()],
        &[10.0],
    );
}

#[test]
fn ray_starting_inside_a_sphere_hits_the_exit_point() {
    let ray = ray_along_negative_z([0.0, 0.0, 0.0]);

    assert_close(
        &[ray.intersect_sphere([0.0, 0.0, 0.0], 3.0).unwrap()],
        &[3.0],
    );
}

#[test]
fn sphere_behind_the_origin_is_not_hit() {
    let ray = ray_along_negative_z([0.0, 0.0, 0.0]);

    assert_eq!(ray.intersect_sphere([0.0, 0.0, 10.0], 2.0), None);
}

#[test]
fn zero_radius_sphere_is_hit_only_dead_center() {
    let ray = ray_along_negative_z([0.0, 0.0, 10.0]);

    assert_close(
        &[ray.intersect_sphere([0.0, 0.0, 0.0], 0.0).unwrap()],
        &[10.0],
    );
    assert_eq!(ray.intersect_sphere([0.5, 0.0, 0.0], 0.0), None);
}

#[test]
fn invalid_radius_or_center_never_hits() {
    let ray = ray_along_negative_z([0.0, 0.0, 10.0]);

    for radius in [-1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(ray.intersect_sphere([0.0; 3], radius), None, "{radius}");
    }
    assert_eq!(ray.intersect_sphere([f32::NAN, 0.0, 0.0], 1.0), None);
    assert_eq!(ray.intersect_sphere([0.0, f32::INFINITY, 0.0], 1.0), None);
}

#[test]
fn a_zero_direction_ray_never_hits() {
    let ray = Ray {
        origin: [0.0; 3],
        direction: [0.0; 3],
    };

    assert_eq!(ray.intersect_sphere([0.0; 3], 1.0), None);
}

#[test]
fn distance_scales_with_a_non_unit_direction() {
    let ray = Ray {
        origin: [0.0, 0.0, 10.0],
        direction: [0.0, 0.0, -2.0],
    };

    assert_close(&[ray.intersect_sphere([0.0; 3], 2.0).unwrap()], &[4.0]);
}
