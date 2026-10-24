/** Floats in the flat layout `[cx, cy, cz, r, min_x, min_y, min_z, max_x, max_y, max_z]`. */
export const SCENE_BOUNDS_FLOATS = 10;

/**
 * A conservative bounding volume of every entity, kept up to date in O(1)
 * per write: an exact grow-only box and a grow-only sphere (each write that
 * escapes the sphere widens it just enough to cover both).
 *
 * Removals never shrink it, and growth makes it looser than necessary, so
 * {@link SceneBounds.grown} tells callers when an exact O(n) recompute
 * ({@link SceneBounds.replace}) could tighten it. A loose bound is always
 * safe: whole-scene trivial accept can only cause more to be drawn.
 */
export class SceneBounds {
  private readonly center = [0, 0, 0];
  private radius = 0;
  private readonly min = [Infinity, Infinity, Infinity];
  private readonly max = [-Infinity, -Infinity, -Infinity];
  private hasVolume = false;
  /** Set when some entity could not be bounded (non-finite data). */
  private unbounded = false;
  /** Set by bulk writes that skipped per-entity tracking. */
  private stale = false;
  private grownSinceReplace = false;

  /** Whether the bounds can be tested (they hold a finite volume). */
  get usable(): boolean {
    return this.hasVolume && !this.unbounded && !this.stale;
  }

  /** Whether the volume grew since the last exact recompute. */
  get grown(): boolean {
    return this.grownSinceReplace;
  }

  /**
   * Marks the bounds out of date after a bulk write, so the next test
   * recomputes them in one Wasm pass instead of tracking every entity in JS.
   */
  invalidate(): void {
    this.stale = true;
    this.grownSinceReplace = true;
  }

  /** Widens the bounds to cover a sphere of `radius` at `(x, y, z)`. */
  include(x: number, y: number, z: number, radius: number): void {
    if (this.stale) return;
    if (![x, y, z, radius].every(Number.isFinite)) {
      this.unbounded = true;
      this.grownSinceReplace = true;
      return;
    }
    const point = [x, y, z];
    for (let axis = 0; axis < 3; axis++) {
      this.min[axis] = Math.min(this.min[axis]!, point[axis]! - radius);
      this.max[axis] = Math.max(this.max[axis]!, point[axis]! + radius);
    }
    if (!this.hasVolume) {
      this.center.splice(0, 3, x, y, z);
      this.radius = radius;
      this.hasVolume = true;
      this.grownSinceReplace = true;
      return;
    }
    const dx = x - this.center[0]!, dy = y - this.center[1]!, dz = z - this.center[2]!;
    const distance = Math.hypot(dx, dy, dz);
    if (distance + radius <= this.radius) return;

    this.grownSinceReplace = true;
    if (distance === 0) {
      this.radius = radius;
      return;
    }
    // Ritter step: the smallest sphere covering both the old one and the new.
    const grown = (this.radius + distance + radius) / 2;
    const shift = (grown - this.radius) / distance;
    this.center[0]! += dx * shift;
    this.center[1]! += dy * shift;
    this.center[2]! += dz * shift;
    this.radius = grown;
  }

  /**
   * Replaces the bounds with an exact recompute in the flat layout. An
   * empty array means the entities cannot be bounded (none, or non-finite).
   */
  replace(values: ArrayLike<number>): void {
    this.grownSinceReplace = false;
    this.unbounded = false;
    this.stale = false;
    if (values.length !== SCENE_BOUNDS_FLOATS) {
      this.hasVolume = false;
      this.unbounded = values.length !== 0;
      this.min.fill(Infinity);
      this.max.fill(-Infinity);
      return;
    }
    for (let axis = 0; axis < 3; axis++) {
      this.center[axis] = values[axis]!;
      this.min[axis] = values[4 + axis]!;
      this.max[axis] = values[7 + axis]!;
    }
    this.radius = values[3]!;
    this.hasVolume = true;
  }

  /** The flat layout, as the Wasm frustum test expects it. */
  toArray(): Float32Array {
    return Float32Array.of(...this.center, this.radius, ...this.min, ...this.max);
  }
}
