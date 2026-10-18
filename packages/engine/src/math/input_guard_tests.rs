use super::*;

#[test]
fn accepts_ordinary_and_boundary_values() {
    assert!(is_valid_coordinate(0.0));
    assert!(is_valid_coordinate(-123.5));
    assert!(is_valid_coordinate(MAX_COORDINATE));
    assert!(is_valid_coordinate(-MAX_COORDINATE));
}

#[test]
fn rejects_non_finite_and_oversized_values() {
    assert!(!is_valid_coordinate(f32::NAN));
    assert!(!is_valid_coordinate(f32::INFINITY));
    assert!(!is_valid_coordinate(f32::NEG_INFINITY));
    assert!(!is_valid_coordinate(f32::MAX));
    assert!(!is_valid_coordinate(MAX_COORDINATE * 2.0));
}

#[test]
fn a_vec3_is_valid_only_if_every_component_is() {
    assert!(is_valid_vec3([1.0, -2.0, 3.0]));
    assert!(!is_valid_vec3([1.0, f32::NAN, 3.0]));
    assert!(!is_valid_vec3([1.0, 2.0, f32::INFINITY]));
}
