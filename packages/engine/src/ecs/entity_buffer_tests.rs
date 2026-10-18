use super::*;

fn vec3_at(array: &[f32], dense_idx: usize) -> [f32; 3] {
    let start = dense_idx * FLOATS_PER_VEC3;
    array[start..start + FLOATS_PER_VEC3].try_into().unwrap()
}

fn set_position(buf: &mut EntityBuffer, id: usize, value: [f32; 3]) {
    let dense_idx = buf.get_dense_index(id).unwrap();
    EntityBuffer::write_vec3(&mut buf.positions, dense_idx, value);
}

fn position_of(buf: &EntityBuffer, id: usize) -> [f32; 3] {
    vec3_at(&buf.positions, buf.get_dense_index(id).unwrap())
}

#[test]
fn new_entities_get_default_attributes() {
    let mut buf = EntityBuffer::new(1);
    let id = buf.allocate_entity();
    let idx = buf.get_dense_index(id).unwrap();

    assert_eq!(vec3_at(&buf.positions, idx), DEFAULT_POSITION);
    assert_eq!(vec3_at(&buf.scales, idx), DEFAULT_SCALE);
    assert_eq!(vec3_at(&buf.colors, idx), DEFAULT_COLOR);
}

#[test]
fn grows_when_capacity_is_exhausted() {
    let mut buf = EntityBuffer::new(1);
    let ids: Vec<_> = (0..5).map(|_| buf.allocate_entity()).collect();

    assert_eq!(ids, vec![0, 1, 2, 3, 4]);
    assert_eq!(buf.active_count(), 5);
    assert!(buf.capacity() >= 5);
}

#[test]
fn grows_from_zero_capacity() {
    let mut buf = EntityBuffer::new(0);
    buf.allocate_entity();

    assert_eq!(buf.active_count(), 1);
    assert!(buf.capacity() >= 1);
}

#[test]
fn remove_moves_last_entity_data_into_hole_for_all_arrays() {
    let mut buf = EntityBuffer::new(3);
    let a = buf.allocate_entity();
    let b = buf.allocate_entity();
    let c = buf.allocate_entity();
    set_position(&mut buf, a, [1.0; 3]);
    set_position(&mut buf, b, [2.0; 3]);
    set_position(&mut buf, c, [3.0; 3]);
    EntityBuffer::write_vec3(&mut buf.scales, 2, [7.0; 3]);
    EntityBuffer::write_vec3(&mut buf.colors, 2, [5.0; 3]);

    assert_eq!(buf.remove_entity(a), 0);

    assert_eq!(buf.active_count(), 2);
    assert_eq!(buf.get_dense_index(a), None);
    assert_eq!(buf.get_dense_index(c), Some(0));
    assert_eq!(position_of(&buf, c), [3.0; 3]);
    assert_eq!(position_of(&buf, b), [2.0; 3]);
    assert_eq!(vec3_at(&buf.scales, 0), [7.0; 3]);
    assert_eq!(vec3_at(&buf.colors, 0), [5.0; 3]);
}

#[test]
fn recycled_entities_are_reset_to_defaults() {
    let mut buf = EntityBuffer::new(1);
    let a = buf.allocate_entity();
    set_position(&mut buf, a, [9.0; 3]);
    EntityBuffer::write_vec3(&mut buf.scales, 0, [4.0; 3]);
    buf.remove_entity(a);

    let reused = buf.allocate_entity();

    assert_eq!(reused, a);
    assert_eq!(position_of(&buf, reused), DEFAULT_POSITION);
    assert_eq!(vec3_at(&buf.scales, 0), DEFAULT_SCALE);
}

#[test]
fn removing_the_last_entity_reports_no_overwritten_slot() {
    let mut buf = EntityBuffer::new(2);
    buf.allocate_entity();
    let b = buf.allocate_entity();

    assert_eq!(buf.remove_entity(b), -1);
    assert_eq!(buf.active_count(), 1);
}

#[test]
fn invalid_removals_are_ignored() {
    let mut buf = EntityBuffer::new(1);
    let a = buf.allocate_entity();
    assert_eq!(buf.remove_entity(a), -1);
    assert_eq!(buf.remove_entity(a), -1);
    assert_eq!(buf.remove_entity(42), -1);

    assert_eq!(buf.active_count(), 0);
}

#[test]
fn zero_initial_capacity_is_clamped_to_one_slot() {
    let buf = EntityBuffer::new(0);

    assert_eq!(buf.capacity(), 1);
    assert_eq!(buf.slot_count(), 1);
    assert_eq!(buf.active_count(), 0);
}

#[test]
fn oversized_initial_capacity_is_clamped_instead_of_overflowing() {
    for requested in [usize::MAX, MAX_INITIAL_CAPACITY + 1] {
        let buf = EntityBuffer::new(requested);

        assert_eq!(
            buf.slot_count(),
            MAX_INITIAL_CAPACITY,
            "requested {requested}"
        );
    }
}

#[test]
fn out_of_bounds_entity_ids_are_ignored_without_touching_state() {
    let mut buf = EntityBuffer::new(2);
    let id = buf.allocate_entity();
    set_position(&mut buf, id, [4.0, 5.0, 6.0]);

    for bad_id in [1, 2, 1000, usize::MAX] {
        assert_eq!(buf.get_dense_index(bad_id), None);
        assert_eq!(buf.remove_entity(bad_id), -1);
    }

    assert_eq!(buf.active_count(), 1);
    assert_eq!(buf.get_dense_index(id), Some(0));
    assert_eq!(position_of(&buf, id), [4.0, 5.0, 6.0]);
}

#[test]
fn removing_an_entity_twice_does_not_corrupt_the_buffer() {
    let mut buf = EntityBuffer::new(3);
    let a = buf.allocate_entity();
    let b = buf.allocate_entity();
    set_position(&mut buf, b, [9.0; 3]);

    buf.remove_entity(a);
    assert_eq!(buf.remove_entity(a), -1);

    assert_eq!(buf.active_count(), 1);
    assert_eq!(position_of(&buf, b), [9.0; 3]);
    let reused = buf.allocate_entity();
    assert_eq!(reused, a);
    assert_eq!(buf.active_count(), 2);
}

#[test]
fn operations_on_an_empty_buffer_do_not_panic() {
    let mut buf = EntityBuffer::new(1);

    assert_eq!(buf.remove_entity(0), -1);
    assert_eq!(buf.get_dense_index(0), None);
    assert!(buf.positions_slice().is_empty());
    assert!(buf.scales_slice().is_empty());
    assert!(buf.colors_slice().is_empty());
}

#[test]
fn entity_id_at_dense_follows_swap_and_pop_and_ignores_inactive_slots() {
    let mut buf = EntityBuffer::new(3);
    let a = buf.allocate_entity();
    let b = buf.allocate_entity();
    let c = buf.allocate_entity();
    buf.remove_entity(a);

    assert_eq!(buf.entity_id_at_dense(0), Some(c as u32));
    assert_eq!(buf.entity_id_at_dense(1), Some(b as u32));
    assert_eq!(buf.entity_id_at_dense(2), None);
    assert_eq!(buf.entity_id_at_dense(usize::MAX), None);
}
