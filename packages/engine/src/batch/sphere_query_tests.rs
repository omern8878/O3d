use super::*;
use crate::math::camera::ProjectionMode;

fn camera_3d() -> Camera {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    camera
}

/// NDC of a world point, so tests can click exactly on it.
fn ndc_of(camera: &Camera, point: [f32; 3]) -> (f32, f32) {
    let ndc = camera
        .view_proj_mat()
        .transform_point3_projective(point)
        .unwrap();
    (ndc[0], ndc[1])
}

#[test]
fn hits_the_sphere_under_the_point() {
    let camera = Camera::new(1.0);
    let spheres = [-50.0, 0.0, 0.0, 5.0, 50.0, 0.0, 0.0, 5.0];
    let (x, y) = ndc_of(&camera, [50.0, 0.0, 0.0]);

    assert_eq!(raycast_spheres_ndc(&camera, x, y, &spheres), 1);
}

#[test]
fn misses_give_minus_one() {
    let camera = Camera::new(1.0);
    let spheres = [-50.0, 0.0, 0.0, 5.0];

    assert_eq!(raycast_spheres_ndc(&camera, 0.5, 0.5, &spheres), NO_HIT);
    assert_eq!(raycast_spheres_ndc(&camera, 0.0, 0.0, &[]), NO_HIT);
    assert_eq!(
        raycast_spheres_ndc(&camera, f32::NAN, 0.0, &spheres),
        NO_HIT
    );
}

#[test]
fn reports_the_sphere_nearest_to_the_camera() {
    let camera = camera_3d(); // eye at z = 10 looking down -Z
    let spheres = [0.0, 0.0, -20.0, 1.0, 0.0, 0.0, 2.0, 1.0, 0.0, 0.0, 0.0, 1.0];

    assert_eq!(raycast_spheres_ndc(&camera, 0.0, 0.0, &spheres), 1);
}

#[test]
fn ties_go_to_the_lower_index() {
    let camera = Camera::new(1.0);
    let spheres = [0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 3.0];

    assert_eq!(raycast_spheres_ndc(&camera, 0.0, 0.0, &spheres), 0);
}

#[test]
fn ignores_a_trailing_partial_sphere() {
    let camera = Camera::new(1.0);

    assert_eq!(
        raycast_spheres_ndc(&camera, 0.0, 0.0, &[0.0, 0.0, 0.0]),
        NO_HIT
    );
}

#[test]
fn strided_pick_scales_the_fourth_component() {
    let camera = Camera::new(1.0);
    // Scale 2 at x = 10: a hit at x = 13 needs a radius of at least 1.5 per unit.
    let instances = [10.0, 0.0, 0.0, 2.0];
    let (x, y) = ndc_of(&camera, [13.0, 0.0, 0.0]);

    assert_eq!(raycast_ndc(&camera, x, y, &instances, 4, 1.0), NO_HIT);
    assert_eq!(raycast_ndc(&camera, x, y, &instances, 4, 2.0), 0);
}

#[test]
fn culls_spheres_outside_the_frustum() {
    let camera = Camera::new(1.0); // sees x, y in [-100, 100]
    let spheres = [
        0.0,
        0.0,
        0.0,
        1.0, // inside
        500.0,
        0.0,
        0.0,
        1.0, // far right
        103.0,
        0.0,
        0.0,
        5.0, // center outside, but it overlaps the edge
        f32::NAN,
        0.0,
        0.0,
        1.0, // invalid
    ];

    assert_eq!(cull_spheres(&camera, &spheres), vec![0, 2]);
}

#[test]
fn cull_with_an_invalid_radius_scale_keeps_nothing() {
    let camera = Camera::new(1.0);
    let spheres = [0.0, 0.0, 0.0, 1.0];

    assert!(visible_indices(&camera, &spheres, 4, -1.0).is_empty());
    assert!(visible_indices(&camera, &spheres, 4, f32::NAN).is_empty());
}
