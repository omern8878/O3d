//! Validation of untrusted `f32` values arriving across the Wasm boundary.
//!
//! JS can pass `NaN`, infinities or absurdly large numbers. Fed into matrix
//! math these produce `NaN` matrices, so the camera rejects them up front.

/// Largest absolute world coordinate accepted from JS. Far beyond any useful
/// scene, yet small enough that squaring and summing three of them stays
/// finite in `f32`.
pub const MAX_COORDINATE: f32 = 1.0e12;

/// Whether `value` is finite and within `±MAX_COORDINATE`.
pub fn is_valid_coordinate(value: f32) -> bool {
    value.is_finite() && value.abs() <= MAX_COORDINATE
}

/// Whether every component passes [`is_valid_coordinate`].
pub fn is_valid_vec3(v: [f32; 3]) -> bool {
    v.into_iter().all(is_valid_coordinate)
}

#[cfg(test)]
#[path = "input_guard_tests.rs"]
mod tests;
