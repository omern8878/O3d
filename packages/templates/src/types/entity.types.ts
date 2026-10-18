/** Stable external identifier of an entity (never changes while it is alive). */
export type EntityId = number;

/** A 3-component vector. */
export type Vec3 = { x: number; y: number; z: number };

/** A 3-component vector as `[x, y, z]` (or `[r, g, b]` for colors). */
export type Vec3Tuple = [number, number, number];

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
