//! Wasm-facing 2D/3D camera that owns the combined view-projection matrix.
//!
//! JS reads the matrix zero-copy through [`Camera::view_proj_ptr`] (16 `f32`s,
//! column-major) and uploads it to a uniform buffer.

use std::f32::consts::{FRAC_PI_2, PI};

use wasm_bindgen::prelude::*;

use super::mat4::Mat4;
use super::spherical::Spherical;
use super::vec3::{add, sub};

/// Smallest allowed orthographic half-height; keeps the projection invertible.
const MIN_ORTHO_HALF_HEIGHT: f32 = 0.0001;

/// Keeps orbit elevation just short of the poles, where `look_at` would flip.
const MAX_ORBIT_ELEVATION: f32 = FRAC_PI_2 - 0.01;

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
}

#[wasm_bindgen]
impl Camera {
    /// Creates a 2D orthographic camera at `(0, 0, 10)` looking at the origin.
    #[wasm_bindgen(constructor)]
    pub fn new(aspect: f32) -> Self {
        let mut camera = Camera {
            mode: ProjectionMode::Ortho2D,
            eye: [0.0, 0.0, 10.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            aspect,
            fov_y: PI / 4.0,
            ortho_half_height: 100.0,
            near: 0.1,
            far: 1000.0,
            view_proj: Mat4::identity(),
        };
        camera.update_view_proj();
        camera
    }

    pub fn set_mode(&mut self, mode: ProjectionMode) {
        self.mode = mode;
        self.update_view_proj();
    }

    pub fn set_aspect(&mut self, aspect: f32) {
        self.aspect = aspect;
        self.update_view_proj();
    }

    pub fn set_position(&mut self, x: f32, y: f32, z: f32) {
        self.eye = [x, y, z];
        self.update_view_proj();
    }

    pub fn set_target(&mut self, x: f32, y: f32, z: f32) {
        self.target = [x, y, z];
        self.update_view_proj();
    }

    /// Sets the orthographic half-height (world units from center to top edge).
    /// Values at or below `0.0001` are clamped up to it.
    pub fn set_ortho_zoom(&mut self, half_height: f32) {
        self.ortho_half_height = half_height.max(MIN_ORTHO_HALF_HEIGHT);
        self.update_view_proj();
    }

    /// Slides the camera and its target together in the XY plane.
    pub fn pan_2d(&mut self, dx: f32, dy: f32) {
        self.eye[0] += dx;
        self.eye[1] += dy;
        self.target[0] += dx;
        self.target[1] += dy;
        self.update_view_proj();
    }

    /// Orbits the eye around `target` on a sphere, keeping the distance.
    /// Elevation is clamped just short of straight up / down.
    pub fn orbit_3d(&mut self, delta_azimuth: f32, delta_elevation: f32) {
        let Some(mut spherical) = Spherical::from_offset(sub(self.eye, self.target)) else {
            return;
        };
        spherical.azimuth += delta_azimuth;
        spherical.elevation = (spherical.elevation + delta_elevation)
            .clamp(-MAX_ORBIT_ELEVATION, MAX_ORBIT_ELEVATION);

        self.eye = add(self.target, spherical.to_offset());
        self.update_view_proj();
    }

    /// Zooms by multiplying the visible size (`Ortho2D`) or the eye-target
    /// distance (`Perspective3D`) by `factor`. Factors below `0.001` are
    /// raised to it, so `factor < 1` zooms in and `factor > 1` zooms out.
    pub fn zoom_by_factor(&mut self, factor: f32) {
        let factor = factor.max(MIN_ZOOM_FACTOR);

        match self.mode {
            ProjectionMode::Ortho2D => {
                self.ortho_half_height =
                    (self.ortho_half_height * factor).max(MIN_ORTHO_HALF_HEIGHT);
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
    pub fn view_proj(&self) -> &Mat4 {
        &self.view_proj
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

#[cfg(test)]
#[path = "camera_tests.rs"]
mod tests;
