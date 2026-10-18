use super::*;
use std::f32::consts::FRAC_PI_2;

const TOLERANCE: f32 = 1e-5;

fn assert_close(actual: &[f32], expected: &[f32]) {
    for (a, e) in actual.iter().zip(expected) {
        assert!((a - e).abs() < TOLERANCE, "expected {expected:?}, got {actual:?}");
    }
}

#[test]
fn plus_z_is_zero_azimuth_zero_elevation() {
    let s = Spherical::from_offset([0.0, 0.0, 10.0]).unwrap();

    assert_close(&[s.radius, s.azimuth, s.elevation], &[10.0, 0.0, 0.0]);
}

#[test]
fn plus_x_is_a_quarter_turn_of_azimuth() {
    let s = Spherical::from_offset([4.0, 0.0, 0.0]).unwrap();

    assert_close(&[s.azimuth], &[FRAC_PI_2]);
}

#[test]
fn straight_up_has_elevation_of_ninety_degrees() {
    let s = Spherical::from_offset([0.0, 3.0, 0.0]).unwrap();

    assert_close(&[s.radius, s.elevation], &[3.0, FRAC_PI_2]);
}

#[test]
fn round_trips_through_cartesian() {
    let offset = [3.0, -4.0, 5.0];
    let back = Spherical::from_offset(offset).unwrap().to_offset();

    assert_close(&back, &offset);
}

#[test]
fn zero_offset_has_no_spherical_form() {
    assert_eq!(Spherical::from_offset([0.0, 0.0, 0.0]), None);
}
