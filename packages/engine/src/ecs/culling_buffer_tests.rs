use super::*;

/// Default camera: Ortho2D, aspect 1, so x and y in [-100, 100] are visible.
fn camera() -> Camera {
    Camera::new(1.0)
}

/// Adds an entity with a unit-ish scale and a color derived from `tag`.
fn add(buffer: &mut EntityBuffer, position: [f32; 3], tag: f32) {
    let id = buffer.allocate_entity();
    buffer.write_entity(id, position, [tag, tag, 1.0], [tag, tag / 10.0, 0.5]);
}

const INSIDE: [[f32; 3]; 4] = [
    [0.0, 0.0, 0.0],
    [-50.0, 50.0, 0.0],
    [90.0, -90.0, 0.0],
    [10.0, 20.0, 0.0],
];

/// 10 entities in dense order: indices 1, 3, 5 and 7 are on screen.
fn scene() -> EntityBuffer {
    let mut buffer = EntityBuffer::new(10);
    let outside = [500.0, -500.0, 1000.0];
    let mut inside = INSIDE.iter();

    for i in 0..10usize {
        let tag = (i + 1) as f32;
        if matches!(i, 1 | 3 | 5 | 7) {
            add(&mut buffer, *inside.next().unwrap(), tag);
        } else {
            add(&mut buffer, [outside[i % 3], 0.0, 0.0], tag);
        }
    }
    buffer
}

#[test]
fn cull_returns_the_number_of_visible_entities() {
    let mut culling = CullingBuffer::new(4);

    assert_eq!(culling.cull(&scene(), &camera()), 4);
    assert_eq!(culling.visible_count(), 4);
}

#[test]
fn cull_packs_exactly_the_visible_data_in_contiguous_dense_order() {
    let mut culling = CullingBuffer::new(4);
    culling.cull(&scene(), &camera());

    let positions: Vec<f32> = INSIDE.iter().flatten().copied().collect();
    assert_eq!(culling.visible_positions, positions);

    // Entities 1, 3, 5, 7 carry tags 2, 4, 6, 8.
    let tags = [2.0, 4.0, 6.0, 8.0];
    let scales: Vec<f32> = tags.iter().flat_map(|&t| [t, t, 1.0]).collect();
    let colors: Vec<f32> = tags.iter().flat_map(|&t| [t, t / 10.0, 0.5]).collect();
    assert_eq!(culling.visible_scales, scales);
    assert_eq!(culling.visible_colors, colors);
}

#[test]
fn cull_records_the_source_dense_index_of_each_visible_entity() {
    let mut culling = CullingBuffer::new(4);
    culling.cull(&scene(), &camera());

    assert_eq!(culling.visible_ids, vec![1, 3, 5, 7]);
}

#[test]
fn cull_replaces_the_previous_result() {
    let mut culling = CullingBuffer::new(4);
    let buffer = scene();
    culling.cull(&buffer, &camera());

    let mut panned = camera();
    panned.pan_2d(500.0, 0.0); // now only the entities at x = 500 are on screen
    let count = culling.cull(&buffer, &panned);

    assert_eq!(count, 3); // `scene` puts dense entities 0, 6 and 9 at x = 500
    assert_eq!(culling.visible_ids.len(), 3);
    assert_eq!(culling.visible_positions.len(), 9);
    assert!(culling.visible_positions.chunks(3).all(|p| p[0] == 500.0));
}

#[test]
fn cull_keeps_allocated_capacity_between_frames() {
    let mut culling = CullingBuffer::new(10);
    let buffer = scene();
    culling.cull(&buffer, &camera());
    let capacity = culling.visible_positions.capacity();
    let pointer = culling.visible_positions_ptr();

    culling.cull(&buffer, &camera());

    assert_eq!(culling.visible_positions.capacity(), capacity);
    assert_eq!(culling.visible_positions_ptr(), pointer);
}

#[test]
fn cull_grows_beyond_the_initial_capacity() {
    let mut culling = CullingBuffer::new(1);

    assert_eq!(culling.cull(&scene(), &camera()), 4);
    assert_eq!(culling.visible_positions.len(), 12);
}

#[test]
fn cull_of_an_empty_buffer_finds_nothing() {
    let mut culling = CullingBuffer::new(4);

    assert_eq!(culling.cull(&EntityBuffer::new(4), &camera()), 0);
    assert!(culling.visible_positions.is_empty());
}

#[test]
fn cull_ignores_removed_entities() {
    let mut buffer = EntityBuffer::new(4);
    add(&mut buffer, [0.0, 0.0, 0.0], 1.0);
    let removed = buffer.allocate_entity();
    buffer.write_entity(removed, [5.0, 5.0, 0.0], [1.0; 3], [1.0; 3]);
    buffer.remove_entity(removed);
    let mut culling = CullingBuffer::new(4);

    assert_eq!(culling.cull(&buffer, &camera()), 1);
}

#[test]
fn cull_keeps_entities_that_only_partly_overlap_the_screen() {
    let mut buffer = EntityBuffer::new(2);
    let id = buffer.allocate_entity();
    buffer.write_entity(id, [105.0, 0.0, 0.0], [20.0, 20.0, 1.0], [1.0; 3]);
    let mut culling = CullingBuffer::new(2);

    assert_eq!(culling.cull(&buffer, &camera()), 1);
}

#[test]
fn pointers_address_the_packed_arrays() {
    let mut culling = CullingBuffer::new(4);
    culling.cull(&scene(), &camera());

    let positions = unsafe { std::slice::from_raw_parts(culling.visible_positions_ptr(), 12) };
    let ids = unsafe { std::slice::from_raw_parts(culling.visible_ids_ptr(), 4) };

    assert_eq!(positions[..3], INSIDE[0]);
    assert_eq!(ids, [1, 3, 5, 7]);
    assert_eq!(
        culling.visible_scales_ptr(),
        culling.visible_scales.as_ptr()
    );
    assert_eq!(
        culling.visible_colors_ptr(),
        culling.visible_colors.as_ptr()
    );
}

#[test]
fn zero_initial_capacity_is_clamped_and_still_culls() {
    let mut culling = CullingBuffer::new(0);

    assert!(culling.visible_positions.capacity() >= FLOATS_PER_VEC3);
    assert!(culling.visible_ids.capacity() >= 1);
    assert_eq!(culling.cull(&scene(), &camera()), 4);
}

#[test]
fn oversized_initial_capacity_is_clamped_instead_of_overflowing() {
    for requested in [usize::MAX, usize::MAX / 3 + 1, MAX_INITIAL_CAPACITY + 1] {
        let culling = CullingBuffer::new(requested);

        assert!(
            culling.visible_ids.capacity() <= MAX_INITIAL_CAPACITY * 2,
            "requested {requested}"
        );
        assert_eq!(culling.visible_count(), 0);
    }
}

#[test]
fn culling_with_a_degenerate_camera_never_panics_or_corrupts_the_output() {
    let mut camera = camera();
    camera.set_aspect(f32::NAN);
    camera.set_position(f32::INFINITY, 0.0, 0.0);
    camera.set_ortho_zoom(f32::NAN);
    camera.set_target(0.0, 0.0, 10.0);
    camera.set_position(0.0, 0.0, 10.0);

    let mut culling = CullingBuffer::new(1);
    let visible = culling.cull(&scene(), &camera);

    assert_eq!(visible, culling.visible_count());
    assert_eq!(culling.visible_positions.len(), visible * FLOATS_PER_VEC3);
    assert_eq!(culling.visible_ids.len(), visible);
}

#[test]
fn entities_with_non_finite_data_are_culled_without_panicking() {
    let mut buffer = EntityBuffer::new(2);
    add(&mut buffer, [f32::NAN, 0.0, 0.0], 1.0);
    add(&mut buffer, [0.0, f32::INFINITY, 0.0], 1.0);
    add(&mut buffer, [0.0, 0.0, 0.0], f32::NAN);
    add(&mut buffer, [1.0, 1.0, 0.0], 1.0);

    let mut culling = CullingBuffer::new(1);
    culling.cull(&buffer, &camera());

    assert_eq!(culling.visible_ids.last(), Some(&3));
    assert_eq!(
        culling.visible_positions.len(),
        culling.visible_count() * FLOATS_PER_VEC3
    );
}

#[test]
fn culling_an_empty_buffer_twice_stays_consistent() {
    let mut culling = CullingBuffer::new(1);
    let empty = EntityBuffer::new(0);

    assert_eq!(culling.cull(&empty, &camera()), 0);
    assert_eq!(culling.cull(&empty, &camera()), 0);
    assert!(culling.visible_ids.is_empty());
}
