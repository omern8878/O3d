use super::*;

#[test]
fn starts_empty_with_collapsed_white_segments() {
    let buffer = LineBuffer::new(2);

    assert_eq!(buffer.capacity(), 2);
    assert_eq!(buffer.count(), 0);
    assert_eq!(buffer.vertices_slice(), &[0.0; 12]);
    assert_eq!(buffer.colors_slice(), &[0xffff_ffff; 4]);
}

#[test]
fn capacity_and_count_are_clamped() {
    let mut buffer = LineBuffer::new(0);
    assert_eq!(buffer.capacity(), 1);
    assert_eq!(buffer.set_count(5), 1);
    assert_eq!(LineBuffer::new(usize::MAX).capacity(), MAX_CAPACITY);
}

#[test]
fn pointer_writes_land_in_the_segment_layout() {
    let mut buffer = LineBuffer::new(2);
    let vertices = unsafe { std::slice::from_raw_parts_mut(buffer.vertices_ptr(), 12) };
    vertices[6..12].copy_from_slice(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    let colors = unsafe { std::slice::from_raw_parts_mut(buffer.colors_ptr(), 4) };
    colors[2] = 0xff00_00ff;

    assert_eq!(
        &buffer.vertices_slice()[6..],
        &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    );
    assert_eq!(buffer.colors_slice()[2], 0xff00_00ff);
}

#[test]
fn pointers_are_stable_across_count_changes() {
    let mut buffer = LineBuffer::new(8);
    let before = (buffer.vertices_ptr(), buffer.colors_ptr());

    buffer.set_count(8);
    buffer.set_count(0);

    assert_eq!(before, (buffer.vertices_ptr(), buffer.colors_ptr()));
}
