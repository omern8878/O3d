//! Wasm-facing 2D/3D camera that owns the combined view-projection matrix.
//!
//! JS reads the matrix zero-copy through [`Camera::view_proj_ptr`] (16 `f32`s,
//! column-major) and uploads it to a uniform buffer.

use std::f32::consts::PI;

use wasm_bindgen::prelude::*;

use super::mat4::Mat4;

/// Smallest allowed orthographic half-height; keeps the projection invertible.
const MIN_ORTHO_HALF_HEIGHT: f32 = 0.0001;

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
mod tests {
    use super::*;

    const TOLERANCE: f32 = 1e-5;

    fn assert_close(actual: &[f32], expected: &[f32]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < TOLERANCE, "expected {expected:?}, got {actual:?}");
        }
    }

    /// World point -> normalized device coordinates.
    fn to_clip(camera: &Camera, point: [f32; 3]) -> [f32; 3] {
        let [x, y, z, w] = camera.view_proj().transform_point3(point);
        [x / w, y / w, z / w]
    }

    #[test]
    fn defaults_to_an_ortho_camera_centered_on_the_origin() {
        let camera = Camera::new(2.0);

        assert_close(&to_clip(&camera, [0.0, 0.0, 0.0])[..2], &[0.0, 0.0]);
    }

    #[test]
    fn ortho_maps_the_visible_extent_to_the_unit_square() {
        // half_height 100, aspect 2 -> visible area is 200 x 100 around the eye.
        let camera = Camera::new(2.0);

        assert_close(&to_clip(&camera, [200.0, 100.0, 0.0])[..2], &[1.0, 1.0]);
        assert_close(&to_clip(&camera, [-200.0, -100.0, 0.0])[..2], &[-1.0, -1.0]);
        assert_close(&to_clip(&camera, [100.0, 0.0, 0.0])[..2], &[0.5, 0.0]);
    }

    #[test]
    fn ortho_depth_of_the_2d_plane_is_inside_zero_to_one() {
        let camera = Camera::new(1.0);
        let depth = to_clip(&camera, [0.0, 0.0, 0.0])[2];

        assert!((0.0..=1.0).contains(&depth), "depth {depth} outside [0, 1]");
    }

    #[test]
    fn pan_2d_moves_the_view_so_the_new_center_maps_to_the_origin() {
        let mut camera = Camera::new(1.0);
        camera.pan_2d(10.0, 5.0);

        assert_close(&to_clip(&camera, [10.0, 5.0, 0.0])[..2], &[0.0, 0.0]);
        // The old center is now off to the lower-left: 10/100 and 5/100 of the view.
        assert_close(&to_clip(&camera, [0.0, 0.0, 0.0])[..2], &[-0.1, -0.05]);
    }

    #[test]
    fn pan_2d_accumulates() {
        let mut camera = Camera::new(1.0);
        camera.pan_2d(3.0, 0.0);
        camera.pan_2d(-1.0, 4.0);

        assert_close(&to_clip(&camera, [2.0, 4.0, 0.0])[..2], &[0.0, 0.0]);
    }

    #[test]
    fn ortho_zoom_scales_the_visible_area_and_is_clamped() {
        let mut camera = Camera::new(1.0);
        camera.set_ortho_zoom(50.0);
        assert_close(&to_clip(&camera, [50.0, 50.0, 0.0])[..2], &[1.0, 1.0]);

        camera.set_ortho_zoom(-5.0);
        assert!(camera.view_proj().0.iter().all(|v| v.is_finite()));
        assert_close(&to_clip(&camera, [0.0001, 0.0, 0.0])[..1], &[1.0]);
    }

    #[test]
    fn set_aspect_rescales_the_horizontal_extent() {
        let mut camera = Camera::new(1.0);
        camera.set_aspect(2.0);

        assert_close(&to_clip(&camera, [200.0, 0.0, 0.0])[..1], &[1.0]);
    }

    #[test]
    fn perspective_mode_centers_the_target_with_depth_in_range() {
        let mut camera = Camera::new(1.0);
        camera.set_mode(ProjectionMode::Perspective3D);
        let [x, y, depth] = to_clip(&camera, [0.0, 0.0, 0.0]);

        assert_close(&[x, y], &[0.0, 0.0]);
        assert!((0.0..=1.0).contains(&depth), "depth {depth} outside [0, 1]");
    }

    #[test]
    fn setters_recompute_the_view_projection() {
        let mut camera = Camera::new(1.0);
        camera.set_position(5.0, 0.0, 10.0);
        camera.set_target(5.0, 0.0, 0.0);

        assert_close(&to_clip(&camera, [5.0, 0.0, 0.0])[..2], &[0.0, 0.0]);
    }

    #[test]
    fn view_proj_ptr_exposes_the_sixteen_floats_of_the_matrix() {
        let camera = Camera::new(1.0);
        let exposed = unsafe { std::slice::from_raw_parts(camera.view_proj_ptr(), 16) };

        assert_eq!(exposed, &camera.view_proj().0);
    }
}
