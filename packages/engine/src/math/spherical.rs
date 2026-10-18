//! Spherical coordinates for orbiting a point, with `+Y` as the polar axis.
//!
//! ```text
//! x = radius * cos(elevation) * sin(azimuth)
//! y = radius * sin(elevation)
//! z = radius * cos(elevation) * cos(azimuth)
//! ```
//!
//! Azimuth `0` / elevation `0` is the `+Z` axis, so a camera at `(0, 0, d)`
//! looking at the origin starts at `(d, 0, 0)` in spherical form.

use super::vec3::dot;

/// Offsets shorter than this have no meaningful direction.
const MIN_RADIUS: f32 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spherical {
    pub radius: f32,
    /// Rotation around `+Y`, in radians.
    pub azimuth: f32,
    /// Angle above the XZ plane, in radians (`+pi/2` is straight up).
    pub elevation: f32,
}

impl Spherical {
    /// Converts a Cartesian offset, or returns `None` if it is (nearly) zero.
    pub fn from_offset(offset: [f32; 3]) -> Option<Self> {
        let radius = dot(offset, offset).sqrt();
        if radius < MIN_RADIUS {
            return None;
        }
        Some(Self {
            radius,
            azimuth: offset[0].atan2(offset[2]),
            elevation: (offset[1] / radius).clamp(-1.0, 1.0).asin(),
        })
    }

    /// Converts back to a Cartesian offset.
    pub fn to_offset(&self) -> [f32; 3] {
        let horizontal = self.radius * self.elevation.cos();
        [
            horizontal * self.azimuth.sin(),
            self.radius * self.elevation.sin(),
            horizontal * self.azimuth.cos(),
        ]
    }
}

#[cfg(test)]
#[path = "spherical_tests.rs"]
mod tests;
