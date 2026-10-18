/** Methods of a typed array that write to its elements. */
type MutatingMethods = "set" | "fill" | "copyWithin" | "reverse" | "sort";

/**
 * Members removed from the base array type: the writing methods, plus the
 * mutable numeric index signature (a mutable signature would win over the
 * `readonly` one in an intersection) and `subarray` (re-declared below).
 */
type Removed = MutatingMethods | "subarray" | number;

/**
 * Compile-time immutable view over a `Float32Array`.
 *
 * It is the same object at runtime; only the type forbids element writes and
 * mutating methods. `subarray` is narrowed too, so a slice cannot be used to
 * regain write access.
 */
export type ReadonlyFloat32Array = Omit<Float32Array, Removed> & {
  readonly [index: number]: number;
  subarray(begin?: number, end?: number): ReadonlyFloat32Array;
};

/** Compile-time immutable view over a `Uint32Array`; see {@link ReadonlyFloat32Array}. */
export type ReadonlyUint32Array = Omit<Uint32Array, Removed> & {
  readonly [index: number]: number;
  subarray(begin?: number, end?: number): ReadonlyUint32Array;
};

/**
 * Read-only zero-copy views over the active entities (`x y z` / `r g b`
 * triplets, one per entity). They alias Wasm memory and are invalidated by any
 * call that can grow the buffer. Mutate entities through `EntityManager` so
 * dirty tracking stays correct.
 */
export interface ReadonlyRawEntityViews {
  readonly positions: ReadonlyFloat32Array;
  readonly scales: ReadonlyFloat32Array;
  readonly colors: ReadonlyFloat32Array;
}
