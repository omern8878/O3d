use super::*;

#[test]
fn add_sub_and_dot_work_component_wise() {
    assert_eq!(add([1.0, 2.0, 3.0], [1.0, 1.0, 1.0]), [2.0, 3.0, 4.0]);
    assert_eq!(sub([3.0, 2.0, 1.0], [1.0, 1.0, 1.0]), [2.0, 1.0, 0.0]);
    assert_eq!(dot([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]), 32.0);
}

#[test]
fn cross_follows_the_right_hand_rule() {
    assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
    assert_eq!(cross([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]), [0.0, 0.0, -1.0]);
}

#[test]
fn normalize_returns_unit_vectors() {
    assert_eq!(normalize([0.0, 3.0, 4.0]), [0.0, 0.6, 0.8]);
}

#[test]
fn normalize_of_zero_is_zero_not_nan() {
    assert_eq!(normalize([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
}
