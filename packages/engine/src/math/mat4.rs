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

/// Determinants below this are treated as singular (not invertible).
const MIN_INVERTIBLE_DETERMINANT: f64 = 1e-12;

/// `w` components below this cannot be safely divided by.
const MIN_PROJECTIVE_W: f32 = 1e-12;

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

    /// The inverse matrix, or `None` if it is singular or non-finite.
    ///
    /// Uses adjugate expansion over 2x2 sub-determinants. The arithmetic runs
    /// in `f64` so that `M * M^-1` stays close to the identity even for the
    /// badly scaled matrices projections produce.
    pub fn inverse(&self) -> Option<Self> {
        let a = self.0.map(f64::from);

        let s0 = a[0] * a[5] - a[4] * a[1];
        let s1 = a[0] * a[6] - a[4] * a[2];
        let s2 = a[0] * a[7] - a[4] * a[3];
        let s3 = a[1] * a[6] - a[5] * a[2];
        let s4 = a[1] * a[7] - a[5] * a[3];
        let s5 = a[2] * a[7] - a[6] * a[3];
        let c5 = a[10] * a[15] - a[14] * a[11];
        let c4 = a[9] * a[15] - a[13] * a[11];
        let c3 = a[9] * a[14] - a[13] * a[10];
        let c2 = a[8] * a[15] - a[12] * a[11];
        let c1 = a[8] * a[14] - a[12] * a[10];
        let c0 = a[8] * a[13] - a[12] * a[9];

        let determinant = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
        if !determinant.is_finite() || determinant.abs() < MIN_INVERTIBLE_DETERMINANT {
            return None;
        }
        let inv = 1.0 / determinant;

        let adjugate_over_det = [
            (a[5] * c5 - a[6] * c4 + a[7] * c3) * inv,
            (-a[1] * c5 + a[2] * c4 - a[3] * c3) * inv,
            (a[13] * s5 - a[14] * s4 + a[15] * s3) * inv,
            (-a[9] * s5 + a[10] * s4 - a[11] * s3) * inv,
            (-a[4] * c5 + a[6] * c2 - a[7] * c1) * inv,
            (a[0] * c5 - a[2] * c2 + a[3] * c1) * inv,
            (-a[12] * s5 + a[14] * s2 - a[15] * s1) * inv,
            (a[8] * s5 - a[10] * s2 + a[11] * s1) * inv,
            (a[4] * c4 - a[5] * c2 + a[7] * c0) * inv,
            (-a[0] * c4 + a[1] * c2 - a[3] * c0) * inv,
            (a[12] * s4 - a[13] * s2 + a[15] * s0) * inv,
            (-a[8] * s4 + a[9] * s2 - a[11] * s0) * inv,
            (-a[4] * c3 + a[5] * c1 - a[6] * c0) * inv,
            (a[0] * c3 - a[1] * c1 + a[2] * c0) * inv,
            (-a[12] * s3 + a[13] * s1 - a[14] * s0) * inv,
            (a[8] * s3 - a[9] * s1 + a[10] * s0) * inv,
        ];

        let inverse = Mat4(adjugate_over_det.map(|value| value as f32));
        inverse.0.iter().all(|v| v.is_finite()).then_some(inverse)
    }

    /// Transforms `point` as `(x, y, z, 1)` and performs the perspective
    /// divide. Returns `None` if `w` is too close to zero (a point at infinity
    /// or on the camera plane) or the result is not finite.
    pub fn transform_point3_projective(&self, point: [f32; 3]) -> Option<[f32; 3]> {
        let [x, y, z, w] = self.transform_point3(point);
        if !w.is_finite() || w.abs() < MIN_PROJECTIVE_W {
            return None;
        }
        let divided = [x / w, y / w, z / w];
        divided.iter().all(|v| v.is_finite()).then_some(divided)
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
