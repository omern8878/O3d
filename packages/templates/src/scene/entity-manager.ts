import { CullingBuffer, EntityBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import { DirtyTracker } from "../memory/dirty-tracker.ts";
import { FLOATS_PER_VEC3 } from "../memory/vec3-layout.ts";
import { WasmBufferView } from "../memory/wasm-buffer-view.ts";
import type { EntityAttributeArrays, EntityId, EntityTransform } from "../types/entity.types.ts";
import type { ReadonlyRawEntityViews } from "../types/readonly-buffer.types.ts";
import { parseColor } from "../utils/color.utils.ts";
import { SceneBounds } from "./scene-bounds.ts";

/** An entity's culling radius is half its scale diagonal. */
const HALF = 0.5;

/**
 * Developer-facing facade for creating, updating and removing entities.
 *
 * It hides dense indices and Wasm memory handling: callers only deal with
 * stable `EntityId`s. The Wasm module must be initialized (the default `init()`
 * export of `@engine/core`) before constructing a manager.
 */
export class EntityManager {
  private readonly buffer: EntityBuffer;
  private readonly view: WasmBufferView;
  private readonly dirtyTracker = new DirtyTracker();
  private readonly bounds = new SceneBounds();

  constructor(initialCapacity: number = 1000) {
    this.buffer = new EntityBuffer(initialCapacity);
    this.view = new WasmBufferView(
      this.buffer,
      () => wasm_memory() as WebAssembly.Memory,
    );
  }

  /** Creates an entity, optionally applying an initial transform. */
  createEntity(initial?: EntityTransform): EntityId {
    const id = this.buffer.allocate_entity();
    const denseIdx = this.buffer.get_dense_index(id);
    if (denseIdx !== undefined) {
      // Even without an initial transform, Rust wrote default values (e.g. scale 1).
      this.dirtyTracker.markAllChannelsDirty(denseIdx);
      if (initial) {
        this.applyTransform(denseIdx, initial);
      }
      this.includeInBounds(denseIdx);
    }
    return id;
  }

  /**
   * Creates `count` entities at once and returns their IDs. They occupy the
   * dense indices right after the existing entities, so `data` (three numbers
   * per entity per attribute) is copied in one bulk write per attribute.
   *
   * @throws {RangeError} if an array in `data` does not hold exactly `count` triplets.
   */
  createEntities(count: number, data: EntityAttributeArrays = {}): Uint32Array {
    for (const values of [data.positions, data.scales, data.colors]) {
      if (values && values.length !== count * FLOATS_PER_VEC3) {
        throw new RangeError(`Expected ${count * FLOATS_PER_VEC3} values, got ${values.length}.`);
      }
    }
    const ids = this.buffer.allocate_entities(Math.max(0, Math.floor(count)));
    if (ids.length === 0) {
      return ids;
    }
    const first = this.buffer.get_dense_index(ids[0]!)!;
    const last = first + ids.length - 1;
    for (const channel of ["position", "scale", "color"] as const) {
      this.dirtyTracker.markRangeDirty(channel, first, last);
    }
    this.writeRange(first, data);
    this.bounds.invalidate();
    return ids;
  }

  /**
   * Overwrites consecutive entities starting at dense index `firstDense`
   * (the order of {@link EntityManager.getRawViews}) with one bulk copy per
   * attribute, marking exactly that range dirty.
   *
   * @throws {RangeError} if the range does not fit the active entities or an
   * array is not a whole number of triplets.
   */
  writeRange(firstDense: number, data: EntityAttributeArrays): void {
    const channels = [
      ["position", data.positions],
      ["scale", data.scales],
      ["color", data.colors],
    ] as const;
    for (const [channel, values] of channels) {
      if (!values || values.length === 0) continue;
      const count = values.length / FLOATS_PER_VEC3;
      if (!Number.isInteger(firstDense) || firstDense < 0 || !Number.isInteger(count) ||
          firstDense + count > this.buffer.active_count()) {
        throw new RangeError(`Cannot write ${values.length} values at dense index ${firstDense}.`);
      }
      this.view.writeRange(channel, firstDense, values);
      this.dirtyTracker.markRangeDirty(channel, firstDense, firstDense + count - 1);
    }
    if (data.positions?.length || data.scales?.length) {
      this.bounds.invalidate();
    }
  }

  /** Whether `id` refers to a live entity. */
  hasEntity(id: EntityId): boolean {
    return this.buffer.get_dense_index(id) !== undefined;
  }

  /** Updates the provided fields of an entity. Unknown IDs are ignored. */
  updateEntity(id: EntityId, transform: EntityTransform): void {
    const denseIdx = this.buffer.get_dense_index(id);
    if (denseIdx === undefined) {
      return;
    }
    // Mark first: applyTransform can throw (invalid color) after a partial write.
    this.markTransformDirty(denseIdx, transform);
    this.applyTransform(denseIdx, transform);
    if (transform.position || transform.scale) {
      this.includeInBounds(denseIdx);
    }
  }

  /** Removes an entity. Unknown IDs are ignored. */
  removeEntity(id: EntityId): void {
    const overwrittenDenseIdx = this.buffer.remove_entity(id);
    if (overwrittenDenseIdx >= 0) {
      // Swap-and-pop moved the last entity's data into this slot.
      this.dirtyTracker.markAllChannelsDirty(overwrittenDenseIdx);
    }
  }

  /**
   * Tracks which dense indices changed since the GPU was last synchronized.
   * @internal Used by the renderer; calling `clear()` or marking ranges from
   * outside desynchronizes the GPU copy.
   */
  getDirtyTracker(): DirtyTracker {
    return this.dirtyTracker;
  }

  /**
   * A conservative bounding volume of every entity, grown in O(1) on each
   * write. Used for whole-scene trivial accept before culling.
   * @internal
   */
  getSceneBounds(): SceneBounds {
    return this.bounds;
  }

  /** Recomputes the scene bounds exactly from the Wasm data, in one O(n) pass. */
  recomputeSceneBounds(): void {
    this.bounds.replace(CullingBuffer.compute_scene_bounds(this.buffer));
  }

  /**
   * The underlying Wasm buffer, for Wasm-side systems such as culling.
   * @internal Mutating it directly bypasses dirty tracking.
   */
  getRawWasmBuffer(): EntityBuffer {
    return this.buffer;
  }

  getActiveCount(): number {
    return this.buffer.active_count();
  }

  /** Frees the entity storage in Wasm memory. The manager must not be used afterwards. */
  destroy(): void {
    this.buffer.free();
  }

  getCapacity(): number {
    return this.buffer.capacity();
  }

  /**
   * Read-only zero-copy views trimmed to the active entities. They alias Wasm
   * memory and become stale after the buffer grows; write through
   * {@link EntityManager.updateEntity} so changes are tracked for the GPU.
   */
  getRawViews(): ReadonlyRawEntityViews {
    const end = this.buffer.active_count() * FLOATS_PER_VEC3;
    return {
      positions: this.view.getPositionsView().subarray(0, end),
      scales: this.view.getScalesView().subarray(0, end),
      colors: this.view.getColorsView().subarray(0, end),
    };
  }

  private includeInBounds(denseIdx: number): void {
    const o = denseIdx * FLOATS_PER_VEC3;
    const positions = this.view.getPositionsView();
    const scales = this.view.getScalesView();
    const radius = HALF * Math.hypot(scales[o]!, scales[o + 1]!, scales[o + 2]!);
    this.bounds.include(positions[o]!, positions[o + 1]!, positions[o + 2]!, radius);
  }

  private markTransformDirty(denseIdx: number, transform: EntityTransform): void {
    if (transform.position) this.dirtyTracker.markDirty("position", denseIdx);
    if (transform.scale) this.dirtyTracker.markDirty("scale", denseIdx);
    if (transform.color !== undefined) this.dirtyTracker.markDirty("color", denseIdx);
  }

  private applyTransform(denseIdx: number, transform: EntityTransform): void {
    if (transform.position) {
      this.view.writePartialVec3("position", denseIdx, transform.position);
    }
    if (transform.scale) {
      this.view.writePartialVec3("scale", denseIdx, transform.scale);
    }
    if (transform.color !== undefined) {
      const [r, g, b] = parseColor(transform.color);
      this.view.writeVec3("color", denseIdx, r, g, b);
    }
  }
}
