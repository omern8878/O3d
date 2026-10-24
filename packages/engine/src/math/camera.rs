//! Wasm-facing 2D/3D camera that owns the combined view-projection matrix.
//!
//! JS reads the matrix zero-copy through [`Camera::view_proj_ptr`] (16 `f32`s,
//! column-major) and uploads it to a uniform buffer.

use std::f32::consts::{FRAC_PI_2, PI};

use wasm_bindgen::prelude::*;

use super::input_guard::{is_valid_vec3, MAX_COORDINATE};
use super::mat4::Mat4;
use super::ray::Ray;
use super::spherical::Spherical;
use super::vec3::{add, normalize, sub};

/// Smallest allowed orthographic half-height; keeps the projection invertible.
const MIN_ORTHO_HALF_HEIGHT: f32 = 0.0001;

/// Keeps orbit elevation just short of the poles, where `look_at` would flip.
const MAX_ORBIT_ELEVATION: f32 = FRAC_PI_2 - 0.01;

/// Largest orthographic half-height; keeps the projection finite.
const MAX_ORTHO_HALF_HEIGHT: f32 = MAX_COORDINATE;

/// Accepted aspect-ratio range; outside it the projection overflows.
const MIN_ASPECT: f32 = 1.0e-4;
const MAX_ASPECT: f32 = 1.0e4;

/// Aspect ratio used when JS supplies an unusable one at construction.
const DEFAULT_ASPECT: f32 = 1.0;

/// Eye distance used by `lock_to_xy_plane` when the eye sits on the target.
const DEFAULT_XY_PLANE_DISTANCE: f32 = 10.0;

/// Smallest accepted zoom factor; keeps zoom from collapsing to zero.
const MIN_ZOOM_FACTOR: f32 = 0.001;

/// Perspective zoom keeps the eye within these multiples of near / far.
const MIN_ORBIT_RADIUS_IN_NEARS: f32 = 2.0;
const MAX_ORBIT_RADIUS_IN_FARS: f32 = 0.9;

/// How the camera projects the scene.
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ProjectionMode {
    Ortho2D = 0,
    Perspective3D = 1,
}

/// A camera whose `view_proj` is recomputed whenever a setting changes.
#[wasm_bindgen]
pub struct Camera {
    mode: ProjectionMode,
    eye: [f32; 3],
    target: [f32; 3],
    up: [f32; 3],
    aspect: f32,
    fov_y: f32,
    ortho_half_height: f32,
    near: f32,
    far: f32,
    view_proj: Mat4,
    orbit_enabled: bool,
    azimuth_locked: bool,
    elevation_locked: bool,
}

#[wasm_bindgen]
impl Camera {
    /// Creates a 2D orthographic camera at `(0, 0, 10)` looking at the origin.
    ///
    /// An `aspect` that is non-finite or outside `[1e-4, 1e4]` falls back to `1.0`.
    #[wasm_bindgen(constructor)]
    pub fn new(aspect: f32) -> Self {
        let mut camera = Camera {
            mode: ProjectionMode::Ortho2D,
            eye: [0.0, 0.0, 10.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            aspect: if is_valid_aspect(aspect) {
                aspect
            } else {
                DEFAULT_ASPECT
            },
            fov_y: PI / 4.0,
            ortho_half_height: 100.0,
            near: 0.1,
            far: 1000.0,
            view_proj: Mat4::identity(),
            orbit_enabled: true,
            azimuth_locked: false,
            elevation_locked: false,
        };
        camera.update_view_proj();
        camera
    }

    pub fn set_mode(&mut self, mode: ProjectionMode) {
        self.mode = mode;
        self.update_view_proj();
    }

    /// Sets the aspect ratio. Non-finite values and values outside `[1e-4, 1e4]` are ignored.
    pub fn set_aspect(&mut self, aspect: f32) {
        if !is_valid_aspect(aspect) {
            return;
        }
        self.aspect = aspect;
        self.update_view_proj();
    }

    /// Moves the eye. Non-finite or out-of-range coordinates are ignored.
    pub fn set_position(&mut self, x: f32, y: f32, z: f32) {
        if !is_valid_vec3([x, y, z]) {
            return;
        }
        self.eye = [x, y, z];
        self.update_view_proj();
    }

    /// Moves the look-at target. Non-finite or out-of-range coordinates are
    /// ignored.
    pub fn set_target(&mut self, x: f32, y: f32, z: f32) {
        if !is_valid_vec3([x, y, z]) {
            return;
        }
        self.target = [x, y, z];
        self.update_view_proj();
    }

    /// Sets the orthographic half-height (world units from center to top edge).
    /// Values are clamped to `[0.0001, 1e12]`; non-finite values are ignored.
    pub fn set_ortho_zoom(&mut self, half_height: f32) {
        if !half_height.is_finite() {
            return;
        }
        self.ortho_half_height = clamp_ortho_half_height(half_height);
        self.update_view_proj();
    }

    /// Slides the camera and its target together in the XY plane.
    /// Ignored if the delta is non-finite or would leave the valid range.
    pub fn pan_2d(&mut self, dx: f32, dy: f32) {
        let eye = [self.eye[0] + dx, self.eye[1] + dy, self.eye[2]];
        let target = [self.target[0] + dx, self.target[1] + dy, self.target[2]];
        if !is_valid_vec3(eye) || !is_valid_vec3(target) {
            return;
        }
        self.eye = eye;
        self.target = target;
        self.update_view_proj();
    }

    /// Orbits the eye around `target` on a sphere, keeping the distance.
    /// Elevation is clamped just short of straight up / down. Does nothing for
    /// non-finite deltas, when the eye coincides with the target, or while
    /// orbiting is disabled; a locked angle ignores its delta.
    pub fn orbit_3d(&mut self, delta_azimuth: f32, delta_elevation: f32) {
        if !self.orbit_enabled || !delta_azimuth.is_finite() || !delta_elevation.is_finite() {
            return;
        }
        let delta_azimuth = if self.azimuth_locked {
            0.0
        } else {
            delta_azimuth
        };
        let delta_elevation = if self.elevation_locked {
            0.0
        } else {
            delta_elevation
        };
        let Some(mut spherical) = Spherical::from_offset(sub(self.eye, self.target)) else {
            return;
        };
        spherical.azimuth += delta_azimuth;
        spherical.elevation = (spherical.elevation + delta_elevation)
            .clamp(-MAX_ORBIT_ELEVATION, MAX_ORBIT_ELEVATION);

        self.eye = add(self.target, spherical.to_offset());
        self.update_view_proj();
    }

    /// Enables or disables `orbit_3d`, e.g. while the pointer drags something
    /// else. Pan, zoom and direct placement are unaffected.
    pub fn set_orbit_enabled(&mut self, enabled: bool) {
        self.orbit_enabled = enabled;
    }

    pub fn orbit_enabled(&self) -> bool {
        self.orbit_enabled
    }

    /// Freezes the orbit's azimuth (rotation around `+Y`) and / or elevation.
    pub fn set_orbit_locks(&mut self, lock_azimuth: bool, lock_elevation: bool) {
        self.azimuth_locked = lock_azimuth;
        self.elevation_locked = lock_elevation;
    }

    /// `true` turns the eye to face the XY plane head-on (looking down `-Z`
    /// at the target, keeping its distance) and locks both orbit angles, so
    /// only pan and zoom move the view. `false` unlocks full orbiting from the
    /// current position. The projection mode is left unchanged.
    pub fn lock_to_xy_plane(&mut self, locked: bool) {
        self.set_orbit_locks(locked, locked);
        if !locked {
            return;
        }
        let distance = Spherical::from_offset(sub(self.eye, self.target))
            .map_or(DEFAULT_XY_PLANE_DISTANCE, |spherical| spherical.radius);
        let eye = add(self.target, [0.0, 0.0, distance]);
        if is_valid_vec3(eye) {
            self.eye = eye;
            self.update_view_proj();
        }
    }

    pub fn azimuth_locked(&self) -> bool {
        self.azimuth_locked
    }

    pub fn elevation_locked(&self) -> bool {
        self.elevation_locked
    }

    /// Unit vector from the eye towards the target, as `[x, y, z]` (the zero
    /// vector if they coincide).
    pub fn forward(&self) -> Vec<f32> {
        normalize(sub(self.target, self.eye)).to_vec()
    }

    /// The world-space ray through the screen point `(ndc_x, ndc_y)` (`[-1, 1]`,
    /// `+Y` up) as `[ox, oy, oz, dx, dy, dz]`: it starts on the near plane and
    /// its direction is unit length. Empty for non-finite coordinates or a
    /// non-invertible camera.
    pub fn unproject_ndc(&self, ndc_x: f32, ndc_y: f32) -> Vec<f32> {
        self.ray_through_ndc(ndc_x, ndc_y)
            .map(|ray| [ray.origin, ray.direction].concat())
            .unwrap_or_default()
    }

    /// Zooms by multiplying the visible size (`Ortho2D`) or the eye-target
    /// distance (`Perspective3D`) by `factor`. Factors below `0.001` are
    /// raised to it, so `factor < 1` zooms in and `factor > 1` zooms out.
    /// Non-finite factors are ignored.
    pub fn zoom_by_factor(&mut self, factor: f32) {
        if !factor.is_finite() {
            return;
        }
        let factor = factor.max(MIN_ZOOM_FACTOR);

        match self.mode {
            ProjectionMode::Ortho2D => {
                self.ortho_half_height = clamp_ortho_half_height(self.ortho_half_height * factor);
            }
            ProjectionMode::Perspective3D => {
                let Some(mut spherical) = Spherical::from_offset(sub(self.eye, self.target)) else {
                    return;
                };
                spherical.radius = (spherical.radius * factor).clamp(
                    self.near * MIN_ORBIT_RADIUS_IN_NEARS,
                    self.far * MAX_ORBIT_RADIUS_IN_FARS,
                );
                self.eye = add(self.target, spherical.to_offset());
            }
        }
        self.update_view_proj();
    }

    /// World units from the view center to the top edge in `Ortho2D` mode.
    pub fn ortho_half_height(&self) -> f32 {
        self.ortho_half_height
    }

    pub fn aspect(&self) -> f32 {
        self.aspect
    }

    /// Pointer to the 16 column-major `f32`s of the combined view-projection.
    pub fn view_proj_ptr(&self) -> *const f32 {
        self.view_proj.0.as_ptr()
    }
}

impl Camera {
    /// The combined view-projection matrix (not exported to JS).
    pub(crate) fn view_proj_mat(&self) -> &Mat4 {
        &self.view_proj
    }

    /// The world-space ray through an NDC point; see [`Camera::unproject_ndc`].
    pub(crate) fn ray_through_ndc(&self, ndc_x: f32, ndc_y: f32) -> Option<Ray> {
        let inv_view_proj = self.view_proj.inverse()?;
        Ray::from_ndc(ndc_x, ndc_y, &inv_view_proj)
    }

    fn projection(&self) -> Mat4 {
        match self.mode {
            ProjectionMode::Ortho2D => {
                let half_height = self.ortho_half_height;
                let half_width = half_height * self.aspect;
                Mat4::orthographic_rh_zo(
                    -half_width,
                    half_width,
                    -half_height,
                    half_height,
                    self.near,
                    self.far,
                )
            }
            ProjectionMode::Perspective3D => {
                Mat4::perspective_rh_zo(self.fov_y, self.aspect, self.near, self.far)
            }
        }
    }

    fn update_view_proj(&mut self) {
        let view = Mat4::look_at_rh(self.eye, self.target, self.up);
        self.view_proj = self.projection().multiply(&view);
    }
}

fn is_valid_aspect(aspect: f32) -> bool {
    (MIN_ASPECT..=MAX_ASPECT).contains(&aspect)
}

/// Clamps into the supported half-height range (`NaN` maps to the minimum).
fn clamp_ortho_half_height(half_height: f32) -> f32 {
    half_height.clamp(MIN_ORTHO_HALF_HEIGHT, MAX_ORTHO_HALF_HEIGHT)
}

#[cfg(test)]
#[path = "camera_tests.rs"]
mod tests;
