/** Per-instance data channels of an `InstancedMesh`. */
export type InstanceChannel = "transform" | "rotation" | "color";

/** Per-segment data channels of a `LineBatch`. */
export type LineChannel = "vertex" | "color";

/**
 * How an `InstancedMesh` is shaded: `'lit'` applies a fixed directional light
 * plus ambient (reads as 3D), `'flat'` outputs the instance color unchanged
 * (e.g. discs in a 2D view).
 */
export type MeshShading = "lit" | "flat";

/** What one `BatchRenderer.render` call drew. */
export type BatchFrameStats = {
  /** Draw calls issued: one per non-empty mesh or line batch. */
  drawCalls: number;
  instances: number;
  segments: number;
};
