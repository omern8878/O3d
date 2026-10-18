/**
 * Zero-copy views over the entities that survived frustum culling, packed
 * contiguously. Each array holds `visibleCount * 3` floats and aliases Wasm
 * memory, so it is only valid until the next cull.
 */
export type VisibleViews = {
  positions: Float32Array;
  scales: Float32Array;
  colors: Float32Array;
  visibleCount: number;
};
