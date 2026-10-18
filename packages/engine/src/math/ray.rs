//! A 3D ray: WebGPU unprojection from normalized device coordinates and
//! ray-sphere intersection. Pure math with no Wasm types.

use super::mat4::Mat4;
use super::vec3::{dot, normalize, sub};

/// NDC depth of the near plane in WebGPU's `[0, 1]` clip range.
const NDC_NEAR_DEPTH: f32 = 0.0;

/// NDC depth of the far plane in WebGPU's `[0, 1]` clip range.
const NDC_FAR_DEPTH: f32 = 1.0;

/// A half-line starting at `origin` and extending along `direction`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    pub origin: [f32; 3],
    /// Unit length when built by [`Ray::from_ndc`].
    pub direction: [f32; 3],
}

impl Ray {
    /// The world-space ray through the screen point `(ndc_x, ndc_y)`, running
    /// from the near plane towards the far plane.
    ///
    /// `ndc_x` and `ndc_y` are in `[-1, 1]` with `+Y` up. Returns `None` for
    /// non-finite coordinates, or if the unprojection is degenerate.
    pub fn from_ndc(ndc_x: f32, ndc_y: f32, inv_view_proj: &Mat4) -> Option<Self> {
        if !ndc_x.is_finite() || !ndc_y.is_finite() {
            return None;
        }

        let near_world =
            inv_view_proj.transform_point3_projective([ndc_x, ndc_y, NDC_NEAR_DEPTH])?;
        let far_world = inv_view_proj.transform_point3_projective([ndc_x, ndc_y, NDC_FAR_DEPTH])?;
        let direction = normalize(sub(far_world, near_world));
        if direction == [0.0; 3] {
            return None;
        }

        Some(Ray {
            origin: near_world,
            direction,
        })
    }

    /// Distance `t >= 0` along the ray to the nearest point on the sphere, so
    /// the hit is `origin + t * direction`. A ray starting inside the sphere
    /// reports the exit point. Returns `None` for a miss, a sphere entirely
    /// behind the origin, or a negative or non-finite radius or center.
    pub fn intersect_sphere(&self, center: [f32; 3], radius: f32) -> Option<f32> {
        if !radius.is_finite() || radius < 0.0 {
            return None;
        }

        // Solves |O + tD - C|^2 = r^2, i.e. a*t^2 + 2*b*t + c = 0.
        let to_origin = sub(self.origin, center);
        let a = dot(self.direction, self.direction);
        let b = dot(to_origin, self.direction);
        let c = dot(to_origin, to_origin) - radius * radius;
        if !a.is_finite() || a <= 0.0 {
            return None;
        }

        let discriminant = b * b - a * c;
        if !discriminant.is_finite() || discriminant < 0.0 {
            return None;
        }

        let root = discriminant.sqrt();
        let entry = (-b - root) / a;
        let exit = (-b + root) / a;
        [entry, exit]
            .into_iter()
            .find(|t| t.is_finite() && *t >= 0.0)
    }
}

#[cfg(test)]
#[path = "ray_tests.rs"]
mod tests;
