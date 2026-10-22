import { Camera, ProjectionMode, wasm_memory } from "@engine/core/pkg/engine.js";
import type { InstancedRenderer } from "../renderer/instanced-renderer.ts";
import type { CameraConfig, CameraMode } from "../types/camera.types.ts";
import type { ReadonlyFloat32Array } from "../types/readonly-buffer.types.ts";

/** Only the renderer capability the controller needs. */
type CameraUploader = Pick<InstancedRenderer, "updateCamera">;

const PROJECTION_MODES: Record<CameraMode, ProjectionMode> = {
  "2d": ProjectionMode.Ortho2D,
  "3d": ProjectionMode.Perspective3D,
};

const MATRIX_FLOATS = 16;

/**
 * Ergonomic facade over the Wasm `Camera`.
 *
 * Every mutator marks the camera dirty, and {@link CameraController.syncIfDirty}
 * uploads the 64-byte uniform only when something changed. The Wasm module
 * must be initialized before constructing a controller.
 */
export class CameraController {
  private readonly wasmCamera: Camera;
  private readonly wasmMemoryFn: () => WebAssembly.Memory;
  private mode: CameraMode = "2d";
  private dirty = true;

  constructor(
    config: CameraConfig = {},
    wasmMemoryFn: () => WebAssembly.Memory = () => wasm_memory() as WebAssembly.Memory,
  ) {
    this.wasmCamera = new Camera(config.aspect ?? 1);
    this.wasmMemoryFn = wasmMemoryFn;
    if (config.mode) this.setMode(config.mode);
    if (config.position) {
      const { x, y, z } = config.position;
      this.setPosition(x, y, z);
    }
    if (config.target) {
      const { x, y, z } = config.target;
      this.setTarget(x, y, z);
    }
    if (config.orthoHalfHeight !== undefined) {
      this.wasmCamera.set_ortho_zoom(config.orthoHalfHeight);
    }
  }

  setMode(mode: CameraMode): void {
    this.wasmCamera.set_mode(PROJECTION_MODES[mode]);
    this.mode = mode;
    this.dirty = true;
  }

  getMode(): CameraMode {
    return this.mode;
  }

  /**
   * The current column-major `view_proj` matrix (16 floats) as a read-only
   * zero-copy view of Wasm memory. It reflects later camera changes but is
   * invalidated if Wasm memory grows, so read it again rather than keeping it.
   */
  getViewProjection(): ReadonlyFloat32Array {
    return new Float32Array(
      this.wasmMemoryFn().buffer,
      this.wasmCamera.view_proj_ptr(),
      MATRIX_FLOATS,
    );
  }

  /** Updates the aspect ratio from the viewport size (in pixels). */
  resize(viewportWidth: number, viewportHeight: number): void {
    this.wasmCamera.set_aspect(
      Math.max(viewportWidth, 1) / Math.max(viewportHeight, 1),
    );
    this.dirty = true;
  }

  /**
   * Pans a 2D camera by a screen-space drag, so the world follows the cursor:
   * dragging right moves the scene right, dragging down moves it down.
   */
  panByPixels(deltaX: number, deltaY: number, viewportHeight: number): void {
    const worldPerPixel =
      (this.wasmCamera.ortho_half_height() * 2) / Math.max(viewportHeight, 1);
    this.wasmCamera.pan_2d(-deltaX * worldPerPixel, deltaY * worldPerPixel);
    this.dirty = true;
  }

  /** Orbits around the target by the given angles, in radians. */
  orbit(deltaAzimuthRad: number, deltaElevationRad: number): void {
    this.wasmCamera.orbit_3d(deltaAzimuthRad, deltaElevationRad);
    this.dirty = true;
  }

  /**
   * Sets the 2D view's half-height in world units (center to top edge).
   * Values are clamped to a safe range; non-finite values are ignored.
   */
  setOrthoHalfHeight(halfHeight: number): void {
    this.wasmCamera.set_ortho_zoom(halfHeight);
    this.dirty = true;
  }

  /** Multiplies the zoom level; `factor < 1` zooms in, `> 1` zooms out. */
  zoom(factor: number): void {
    this.wasmCamera.zoom_by_factor(factor);
    this.dirty = true;
  }

  setPosition(x: number, y: number, z: number): void {
    this.wasmCamera.set_position(x, y, z);
    this.dirty = true;
  }

  setTarget(x: number, y: number, z: number): void {
    this.wasmCamera.set_target(x, y, z);
    this.dirty = true;
  }

  /**
   * Uploads the camera to the renderer if it changed since the last sync.
   * Returns whether an upload happened (`false` means 0 bytes were sent).
   */
  syncIfDirty(renderer: CameraUploader): boolean {
    if (!this.dirty) {
      return false;
    }
    renderer.updateCamera(this.wasmCamera);
    this.dirty = false;
    return true;
  }

  /** Frees the Wasm camera. The controller must not be used afterwards. */
  destroy(): void {
    this.wasmCamera.free();
  }

  /**
   * The underlying Wasm camera, for Wasm-side systems such as culling.
   * @internal Mutating it directly bypasses the controller's dirty flag.
   */
  getRawWasmCamera(): Camera {
    return this.wasmCamera;
  }
}
