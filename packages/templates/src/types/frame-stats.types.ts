/** One `writeBuffer` into an instance buffer during a frame. */
export type InstanceUpload = {
  /** Which per-instance attribute buffer was written. */
  readonly channel: "position" | "scale" | "color";
  /** Byte offset of the write inside that buffer. */
  readonly byteOffset: number;
  /** Bytes sent to the GPU by this write. */
  readonly byteLength: number;
};

/** What the last `renderFrame()` drew and uploaded. */
export type FrameStats = {
  /** Instances drawn (the visible count when culling is on). */
  readonly drawnCount: number;
  /** Live nodes in the scene. */
  readonly totalCount: number;
  /** Instance bytes uploaded to the GPU (the 64-byte camera uniform is not counted). */
  readonly uploadedBytes: number;
  /** The individual instance-buffer writes behind `uploadedBytes`. */
  readonly uploads: readonly InstanceUpload[];
};
