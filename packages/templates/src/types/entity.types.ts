/** Stable external identifier of an entity (never changes while it is alive). */
export type EntityId = number;

/** A 3-component vector. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * A color given either as a hex string (`"#RRGGBB"` or `"#RGB"`) or as a
 * normalized RGB object with each channel in `0..1`.
 */
export type ColorInput = string | { r: number; g: number; b: number };

/** Partial description of an entity's state; omitted fields stay untouched. */
export type EntityTransform = {
  position?: Partial<Vec3>;
  scale?: Partial<Vec3>;
  color?: ColorInput;
};

/**
 * Zero-copy views over the active entities' data (`x y z` / `r g b` triplets,
 * one per entity). Intended for read-only inspection; they alias Wasm memory and
 * are invalidated by any call that can grow the buffer.
 */
export type RawEntityViews = {
  positions: Float32Array;
  scales: Float32Array;
  colors: Float32Array;
};
