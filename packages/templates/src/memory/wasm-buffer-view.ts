import type { EntityBuffer } from "@engine/core/pkg/engine.js";
import type { Vec3 } from "../types/entity.types.ts";
import { FLOATS_PER_VEC3 } from "./vec3-layout.ts";

/**
 * Owns the zero-copy `Float32Array` views over an `EntityBuffer`'s Wasm memory.
 *
 * Wasm memory can be reallocated (buffer growth) or detached (memory growth),
 * which silently invalidates typed-array views. Every public method re-syncs
 * the cached views first, so callers never touch a stale view.
 */
export class WasmBufferView {
  private positionsView = new Float32Array(0);
  private scalesView = new Float32Array(0);
  private colorsView = new Float32Array(0);
  /** `-1` forces the first access to build the views. */
  private cachedCapacity = -1;

  private readonly wasmBuffer: EntityBuffer;
  private readonly wasmMemoryFn: () => WebAssembly.Memory;

  constructor(
    wasmBuffer: EntityBuffer,
    wasmMemoryFn: () => WebAssembly.Memory,
  ) {
    this.wasmBuffer = wasmBuffer;
    this.wasmMemoryFn = wasmMemoryFn;
  }

  /** Writes all three components of an attribute for the entity at `denseIdx`. */
  writeVec3(
    viewType: "position" | "scale" | "color",
    denseIdx: number,
    x: number,
    y: number,
    z: number,
  ): void {
    this.syncViewsIfNeeded();
    const view = this.viewFor(viewType);
    const offset = denseIdx * FLOATS_PER_VEC3;
    view[offset] = x;
    view[offset + 1] = y;
    view[offset + 2] = z;
  }

  /** Writes only the components present in `partial`, leaving the rest as-is. */
  writePartialVec3(
    viewType: "position" | "scale",
    denseIdx: number,
    partial: Partial<Vec3>,
  ): void {
    this.syncViewsIfNeeded();
    const view = this.viewFor(viewType);
    const offset = denseIdx * FLOATS_PER_VEC3;
    if (partial.x !== undefined) view[offset] = partial.x;
    if (partial.y !== undefined) view[offset + 1] = partial.y;
    if (partial.z !== undefined) view[offset + 2] = partial.z;
  }

  /**
   * Copies `values` (whole `x, y, z` triplets) into an attribute starting at
   * `firstDense`: one bulk copy into Wasm memory.
   */
  writeRange(
    viewType: "position" | "scale" | "color",
    firstDense: number,
    values: ArrayLike<number>,
  ): void {
    this.syncViewsIfNeeded();
    this.viewFor(viewType).set(values, firstDense * FLOATS_PER_VEC3);
  }

  /** Full-capacity positions view (for inspection / debugging). */
  getPositionsView(): Float32Array {
    this.syncViewsIfNeeded();
    return this.positionsView;
  }

  /** Full-capacity scales view (for inspection / debugging). */
  getScalesView(): Float32Array {
    this.syncViewsIfNeeded();
    return this.scalesView;
  }

  /** Full-capacity colors view (for inspection / debugging). */
  getColorsView(): Float32Array {
    this.syncViewsIfNeeded();
    return this.colorsView;
  }

  private viewFor(viewType: "position" | "scale" | "color"): Float32Array {
    switch (viewType) {
      case "position":
        return this.positionsView;
      case "scale":
        return this.scalesView;
      case "color":
        return this.colorsView;
    }
  }

  /**
   * Rebuilds the views if Rust reallocated the arrays (capacity changed) or
   * Wasm memory grew (the old `ArrayBuffer` is detached and reports length 0).
   */
  private syncViewsIfNeeded(): void {
    const capacity = this.wasmBuffer.capacity();
    const isDetached = this.positionsView.buffer.byteLength === 0;
    if (capacity === this.cachedCapacity && !isDetached) {
      return;
    }

    const memoryBuffer = this.wasmMemoryFn().buffer;
    const length = capacity * FLOATS_PER_VEC3;
    this.positionsView = new Float32Array(
      memoryBuffer,
      this.wasmBuffer.positions_ptr(),
      length,
    );
    this.scalesView = new Float32Array(
      memoryBuffer,
      this.wasmBuffer.scales_ptr(),
      length,
    );
    this.colorsView = new Float32Array(
      memoryBuffer,
      this.wasmBuffer.colors_ptr(),
      length,
    );
    this.cachedCapacity = capacity;
  }
}
