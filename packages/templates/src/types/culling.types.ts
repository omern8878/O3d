import type { ReadonlyFloat32Array } from "./readonly-buffer.types.ts";

/**
 * Read-only zero-copy views over the entities that survived frustum culling,
 * packed contiguously. Each array holds `visibleCount * 3` floats and aliases
 * Wasm memory, so it is only valid until the next cull.
 */
export type VisibleViews = {
  readonly positions: ReadonlyFloat32Array;
  readonly scales: ReadonlyFloat32Array;
  readonly colors: ReadonlyFloat32Array;
  readonly visibleCount: number;
};
