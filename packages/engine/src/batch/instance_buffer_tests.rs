use super::*;

/// Writes instance `index`'s transform through the raw pointer, as JS does.
fn write_transform(buffer: &mut InstanceBuffer, index: usize, transform: [f32; 4]) {
    let floats =
        unsafe { std::slice::from_raw_parts_mut(buffer.transforms_ptr(), buffer.capacity() * 4) };
    floats[index * 4..index * 4 + 4].copy_from_slice(&transform);
}

#[test]
fn starts_empty_with_default_slots() {
    let buffer = InstanceBuffer::new(3);

    assert_eq!(buffer.capacity(), 3);
    assert_eq!(buffer.count(), 0);
    assert_eq!(
        buffer.transforms_slice(),
        &[0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1.]
    );
    assert_eq!(&buffer.rotations_slice()[..4], &[0., 0., 0., 1.]);
    assert_eq!(buffer.colors_slice(), &[0xffff_ffff; 3]);
}

#[test]
fn capacity_is_clamped() {
    assert_eq!(InstanceBuffer::new(0).capacity(), 1);
    assert_eq!(InstanceBuffer::new(usize::MAX).capacity(), MAX_CAPACITY);
}

#[test]
fn set_count_clamps_to_the_capacity() {
    let mut buffer = InstanceBuffer::new(4);

    assert_eq!(buffer.set_count(2), 2);
    assert_eq!(buffer.set_count(10), 4);
    assert_eq!(buffer.count(), 4);
}

#[test]
fn pointers_are_stable_across_count_changes() {
    let mut buffer = InstanceBuffer::new(8);
    let before = (
        buffer.transforms_ptr(),
        buffer.rotations_ptr(),
        buffer.colors_ptr(),
    );

    buffer.set_count(8);
    buffer.set_count(1);

    assert_eq!(
        before,
        (
            buffer.transforms_ptr(),
            buffer.rotations_ptr(),
            buffer.colors_ptr()
        )
    );
}

#[test]
fn pointer_writes_are_visible_to_queries() {
    let camera = Camera::new(1.0);
    let mut buffer = InstanceBuffer::new(4);
    write_transform(&mut buffer, 0, [-50.0, 0.0, 0.0, 2.0]);
    write_transform(&mut buffer, 1, [50.0, 0.0, 0.0, 2.0]);
    buffer.set_count(2);

    // NDC 0.5 is world x = 50 for the default 2D camera.
    assert_eq!(buffer.raycast_ndc(&camera, 0.5, 0.0, 1.0), 1);
    assert_eq!(buffer.raycast_ndc(&camera, 0.0, 0.0, 1.0), -1);
}

#[test]
fn queries_ignore_inactive_slots() {
    let camera = Camera::new(1.0);
    let mut buffer = InstanceBuffer::new(4);
    write_transform(&mut buffer, 0, [500.0, 0.0, 0.0, 1.0]);
    write_transform(&mut buffer, 1, [0.0, 0.0, 0.0, 1.0]);
    buffer.set_count(1);

    assert_eq!(buffer.raycast_ndc(&camera, 0.0, 0.0, 1.0), -1);
    assert!(buffer.visible_indices(&camera, 1.0).is_empty());

    buffer.set_count(2);
    assert_eq!(buffer.raycast_ndc(&camera, 0.0, 0.0, 1.0), 1);
    assert_eq!(buffer.visible_indices(&camera, 1.0), vec![1]);
}
