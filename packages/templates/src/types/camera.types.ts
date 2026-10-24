import type { Vec3, Vec3Tuple } from "./entity.types.ts";

/** `'2d'` is an orthographic top-down view, `'3d'` a perspective view. */
export type CameraMode = "2d" | "3d";

/** Initial camera settings; omitted fields keep the engine defaults. */
export type CameraConfig = {
  mode?: CameraMode;
  /** Viewport width / height. */
  aspect?: number;
  position?: Vec3;
  target?: Vec3;
  /** World units from the view center to the top edge (2D mode). */
  orthoHalfHeight?: number;
};

/** A world-space ray `origin + t * direction`, with a unit `direction`. */
export type CameraRay = { origin: Vec3Tuple; direction: Vec3Tuple };
