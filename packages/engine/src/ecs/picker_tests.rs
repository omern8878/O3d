use super::*;
use crate::math::camera::ProjectionMode;

/// Default camera: Ortho2D, aspect 1, eye at z = 10 looking down -Z, so
/// NDC `(x, y)` addresses world `(x * 100, y * 100)`.
fn camera_2d() -> Camera {
    Camera::new(1.0)
}

fn camera_3d() -> Camera {
    let mut camera = Camera::new(1.0);
    camera.set_mode(ProjectionMode::Perspective3D);
    camera
}

fn add(buffer: &mut EntityBuffer, position: [f32; 3], scale: [f32; 3]) -> usize {
    let id = buffer.allocate_entity();
    buffer.write_entity(id, position, scale, [1.0; 3]);
    id
}

/// NDC of a world point, so tests can click exactly on it.
fn ndc_of(camera: &Camera, point: [f32; 3]) -> (f32, f32) {
    let ndc = camera
        .view_proj_mat()
        .transform_point3_projective(point)
        .unwrap();
    (ndc[0], ndc[1])
}

fn pick(buffer: &EntityBuffer, camera: &Camera, (x, y): (f32, f32)) -> i32 {
    ScenePicker::new().pick_ndc(buffer, camera, x, y)
}

#[test]
fn picks_the_entity_under_the_point_in_2d() {
    let mut buffer = EntityBuffer::new(4);
    let left = add(&mut buffer, [-50.0, 0.0, 0.0], [10.0, 10.0, 1.0]);
    let right = add(&mut buffer, [50.0, 20.0, 0.0], [10.0, 10.0, 1.0]);
    let camera = camera_2d();

    assert_eq!(pick(&buffer, &camera, (-0.5, 0.0)), left as i32);
    assert_eq!(pick(&buffer, &camera, (0.5, 0.2)), right as i32);
}

#[test]
fn returns_minus_one_when_nothing_is_under_the_point() {
    let mut buffer = EntityBuffer::new(2);
    add(&mut buffer, [50.0, 0.0, 0.0], [10.0, 10.0, 1.0]);

    assert_eq!(pick(&buffer, &camera_2d(), (-0.5, 0.0)), -1);
    assert_eq!(pick(&buffer, &camera_2d(), (5.0, 5.0)), -1);
}

#[test]
fn an_empty_buffer_picks_nothing() {
    assert_eq!(pick(&EntityBuffer::new(1), &camera_2d(), (0.0, 0.0)), -1);
}

#[test]
fn the_picking_radius_is_half_the_largest_scale() {
    let mut buffer = EntityBuffer::new(1);
    add(&mut buffer, [0.0, 0.0, 0.0], [10.0, 2.0, 2.0]); // radius 5
    let camera = camera_2d();

    assert_ne!(pick(&buffer, &camera, (0.049, 0.0)), -1); // x = 4.9
    assert_eq!(pick(&buffer, &camera, (0.052, 0.0)), -1); // x = 5.2
}

#[test]
fn negative_scale_uses_its_magnitude() {
    let mut buffer = EntityBuffer::new(1);
    let id = add(&mut buffer, [0.0; 3], [-10.0, 2.0, 2.0]);

    assert_eq!(pick(&buffer, &camera_2d(), (0.04, 0.0)), id as i32);
}

#[test]
fn the_entity_closer_to_the_camera_wins_in_2d_regardless_of_creation_order() {
    for near_first in [true, false] {
        let mut buffer = EntityBuffer::new(2);
        let (near, far);
        if near_first {
            near = add(&mut buffer, [0.0, 0.0, 5.0], [4.0, 4.0, 1.0]);
            far = add(&mut buffer, [0.0, 0.0, 0.0], [4.0, 4.0, 1.0]);
        } else {
            far = add(&mut buffer, [0.0, 0.0, 0.0], [4.0, 4.0, 1.0]);
            near = add(&mut buffer, [0.0, 0.0, 5.0], [4.0, 4.0, 1.0]);
        }

        let picked = pick(&buffer, &camera_2d(), (0.0, 0.0));

        assert_eq!(picked, near as i32, "near_first = {near_first}");
        assert_ne!(picked, far as i32);
    }
}

#[test]
fn the_entity_closer_to_the_camera_wins_in_3d() {
    let mut buffer = EntityBuffer::new(3);
    let behind = add(&mut buffer, [0.0, 0.0, -5.0], [4.0; 3]);
    let front = add(&mut buffer, [0.0, 0.0, 5.0], [4.0; 3]);
    let middle = add(&mut buffer, [0.0, 0.0, 0.0], [4.0; 3]);

    let picked = pick(&buffer, &camera_3d(), (0.0, 0.0));

    assert_eq!(picked, front as i32);
    assert_ne!(picked, behind as i32);
    assert_ne!(picked, middle as i32);
}

#[test]
fn picks_offset_entities_in_3d() {
    let mut buffer = EntityBuffer::new(2);
    let a = add(&mut buffer, [3.0, 2.0, 0.0], [2.0; 3]);
    let b = add(&mut buffer, [-4.0, -1.0, -3.0], [2.0; 3]);
    let camera = camera_3d();

    assert_eq!(
        pick(&buffer, &camera, ndc_of(&camera, [3.0, 2.0, 0.0])),
        a as i32
    );
    assert_eq!(
        pick(&buffer, &camera, ndc_of(&camera, [-4.0, -1.0, -3.0])),
        b as i32
    );
    assert_eq!(pick(&buffer, &camera, (0.0, 0.0)), -1);
}

#[test]
fn picking_follows_a_moved_and_orbited_camera() {
    let mut buffer = EntityBuffer::new(1);
    let id = add(&mut buffer, [10.0, 0.0, 0.0], [4.0; 3]);
    let mut camera = camera_3d();
    camera.orbit_3d(0.7, 0.3);

    assert_eq!(
        pick(&buffer, &camera, ndc_of(&camera, [10.0, 0.0, 0.0])),
        id as i32
    );
}

#[test]
fn entities_behind_the_camera_are_not_picked() {
    let mut buffer = EntityBuffer::new(1);
    add(&mut buffer, [0.0, 0.0, 20.0], [10.0; 3]); // camera is at z = 10

    assert_eq!(pick(&buffer, &camera_2d(), (0.0, 0.0)), -1);
}

#[test]
fn equal_distance_ties_go_to_the_lower_dense_index() {
    let mut buffer = EntityBuffer::new(2);
    let first = add(&mut buffer, [0.0; 3], [10.0; 3]);
    add(&mut buffer, [0.0; 3], [10.0; 3]);

    assert_eq!(pick(&buffer, &camera_2d(), (0.0, 0.0)), first as i32);
}

#[test]
fn resolves_the_stable_entity_id_not_the_dense_index_after_removals() {
    let mut buffer = EntityBuffer::new(4);
    let a = add(&mut buffer, [-60.0, 0.0, 0.0], [10.0; 3]);
    let b = add(&mut buffer, [0.0, 0.0, 0.0], [10.0; 3]);
    let c = add(&mut buffer, [60.0, 0.0, 0.0], [10.0; 3]);
    let camera = camera_2d();

    // Swap-and-pop moves `c` into `a`'s dense slot 0.
    buffer.remove_entity(a);

    assert_eq!(buffer.get_dense_index(c), Some(0));
    assert_eq!(pick(&buffer, &camera, (0.6, 0.0)), c as i32);
    assert_eq!(pick(&buffer, &camera, (0.0, 0.0)), b as i32);
    assert_eq!(pick(&buffer, &camera, (-0.6, 0.0)), -1);
}

#[test]
fn a_recycled_id_is_picked_at_its_new_position() {
    let mut buffer = EntityBuffer::new(2);
    let old = add(&mut buffer, [-60.0, 0.0, 0.0], [10.0; 3]);
    buffer.remove_entity(old);
    let reused = add(&mut buffer, [60.0, 0.0, 0.0], [10.0; 3]);

    assert_eq!(reused, old);
    assert_eq!(pick(&buffer, &camera_2d(), (0.6, 0.0)), reused as i32);
    assert_eq!(pick(&buffer, &camera_2d(), (-0.6, 0.0)), -1);
}

#[test]
fn non_finite_ndc_picks_nothing() {
    let mut buffer = EntityBuffer::new(1);
    add(&mut buffer, [0.0; 3], [10.0; 3]);
    let picker = ScenePicker::new();
    let camera = camera_2d();

    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(picker.pick_ndc(&buffer, &camera, bad, 0.0), -1);
        assert_eq!(picker.pick_ndc(&buffer, &camera, 0.0, bad), -1);
    }
}

#[test]
fn a_camera_with_no_usable_inverse_picks_nothing() {
    let mut buffer = EntityBuffer::new(1);
    add(&mut buffer, [0.0; 3], [10.0; 3]);
    let mut camera = camera_2d();
    camera.set_ortho_zoom(f32::MAX); // clamped to a view too large to invert

    assert!(camera.view_proj_mat().inverse().is_none());
    assert_eq!(pick(&buffer, &camera, (0.0, 0.0)), -1);
}

#[test]
fn entities_with_non_finite_data_are_never_picked_and_never_panic() {
    let mut buffer = EntityBuffer::new(4);
    add(&mut buffer, [f32::NAN, 0.0, 0.0], [10.0; 3]);
    add(&mut buffer, [0.0, f32::INFINITY, 0.0], [10.0; 3]);
    add(&mut buffer, [0.0; 3], [f32::INFINITY; 3]);
    add(&mut buffer, [0.0; 3], [f32::NAN; 3]);
    let healthy = add(&mut buffer, [50.0, 0.0, 0.0], [10.0; 3]);

    assert_eq!(pick(&buffer, &camera_2d(), (0.0, 0.0)), -1);
    assert_eq!(pick(&buffer, &camera_2d(), (0.5, 0.0)), healthy as i32);
}

#[test]
fn a_default_picker_behaves_like_a_new_one() {
    let mut buffer = EntityBuffer::new(1);
    let id = add(&mut buffer, [0.0; 3], [10.0; 3]);

    let picked = ScenePicker::default().pick_ndc(&buffer, &camera_2d(), 0.0, 0.0);

    assert_eq!(picked, id as i32);
}
