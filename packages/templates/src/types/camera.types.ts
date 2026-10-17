import type { Vec3 } from "./entity.types.ts";

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
