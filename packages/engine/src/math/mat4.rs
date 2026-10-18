//! Pure 4x4 matrix algebra, laid out for WebGPU.
//!
//! # Conventions
//!
//! - **Column-major** storage: `m[column * 4 + row]`. Indices `0..4` are column
//!   0 and indices `12..16` are column 3 (the translation).
//! - Matrices act on column vectors: `clip = projection * view * model * point`.
//! - **Right-handed** coordinates; the camera looks down its local `-Z` axis.
//! - Projections map depth to WebGPU's `[0, 1]` range (`_rh_zo`), not OpenGL's
//!   `[-1, 1]`.

use super::vec3::{cross, dot, normalize, sub};

/// View direction used when `eye == target`.
const DEFAULT_FORWARD: [f32; 3] = [0.0, 0.0, -1.0];

/// Up axes tried, in order, when the requested `up` is unusable.
const FALLBACK_UP_Z: [f32; 3] = [0.0, 0.0, -1.0];
const FALLBACK_UP_X: [f32; 3] = [1.0, 0.0, 0.0];

/// A 4x4 `f32` matrix in column-major order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat4(pub [f32; 16]);

impl Mat4 {
    /// The identity matrix.
    pub fn identity() -> Self {
        let mut m = [0.0; 16];
        m[0] = 1.0;
        m[5] = 1.0;
        m[10] = 1.0;
        m[15] = 1.0;
        Mat4(m)
    }

    /// Returns `self * rhs`: the transform that applies `rhs` first, then `self`.
    pub fn multiply(&self, rhs: &Mat4) -> Self {
        let mut out = [0.0; 16];
        for col in 0..4 {
            for row in 0..4 {
                out[col * 4 + row] = (0..4)
                    .map(|k| self.0[k * 4 + row] * rhs.0[col * 4 + k])
                    .sum();
            }
        }
        Mat4(out)
    }

    /// Orthographic projection mapping `x, y` to `[-1, 1]` and view-space
    /// `z = -near` / `z = -far` to depth `0` / `1`.
    pub fn orthographic_rh_zo(
        left: f32,
        right: f32,
        bottom: f32,
        top: f32,
        near: f32,
        far: f32,
    ) -> Self {
        let mut m = [0.0; 16];
        m[0] = 2.0 / (right - left);
        m[5] = 2.0 / (top - bottom);
        m[10] = -1.0 / (far - near);
        m[12] = -(right + left) / (right - left);
        m[13] = -(top + bottom) / (top - bottom);
        m[14] = -near / (far - near);
        m[15] = 1.0;
        Mat4(m)
    }

    /// Perspective projection with a vertical field of view, mapping view-space
    /// `z = -near` / `z = -far` to depth `0` / `1` after the perspective divide.
    pub fn perspective_rh_zo(fov_y_radians: f32, aspect: f32, near: f32, far: f32) -> Self {
        let focal = 1.0 / (fov_y_radians * 0.5).tan();
        let mut m = [0.0; 16];
        m[0] = focal / aspect;
        m[5] = focal;
        m[10] = far / (near - far);
        m[11] = -1.0;
        m[14] = near * far / (near - far);
        Mat4(m)
    }

    /// View matrix placing the camera at `eye`, looking at `target`.
    ///
    /// Degenerate input still yields an orthonormal basis: `eye == target`
    /// looks down `-Z`, and an `up` that is zero or parallel to the view
    /// direction is replaced by a perpendicular axis.
    #[rustfmt::skip] // keeps the 4x4 literal laid out as columns
    pub fn look_at_rh(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> Self {
        let mut forward = normalize(sub(target, eye));
        if forward == [0.0; 3] {
            forward = DEFAULT_FORWARD;
        }
        let right = Self::right_vector(forward, up);
        let true_up = cross(right, forward);

        Mat4([
            right[0], true_up[0], -forward[0], 0.0,
            right[1], true_up[1], -forward[1], 0.0,
            right[2], true_up[2], -forward[2], 0.0,
            -dot(right, eye), -dot(true_up, eye), dot(forward, eye), 1.0,
        ])
    }

    /// Unit vector perpendicular to `forward` and `up`, trying fallback up axes
    /// when `up` is unusable. `forward` is unit length, so it cannot be
    /// parallel to every fallback.
    fn right_vector(forward: [f32; 3], up: [f32; 3]) -> [f32; 3] {
        [up, FALLBACK_UP_Z, FALLBACK_UP_X]
            .into_iter()
            .map(|candidate| normalize(cross(forward, candidate)))
            .find(|right| *right != [0.0; 3])
            .unwrap_or([1.0, 0.0, 0.0])
    }

    /// Multiplies the matrix by `(x, y, z, 1)` and returns the homogeneous
    /// `[x, y, z, w]`. Divide by `w` for projected points.
    pub fn transform_point3(&self, point: [f32; 3]) -> [f32; 4] {
        let [x, y, z] = point;
        let m = &self.0;
        let component = |row: usize| m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row];
        [component(0), component(1), component(2), component(3)]
    }
}

#[cfg(test)]
#[path = "mat4_tests.rs"]
mod tests;
