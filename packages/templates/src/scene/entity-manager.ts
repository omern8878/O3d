import { EntityBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import { DirtyTracker } from "../memory/dirty-tracker.ts";
import { FLOATS_PER_VEC3 } from "../memory/vec3-layout.ts";
import { WasmBufferView } from "../memory/wasm-buffer-view.ts";
import type { EntityId, EntityTransform } from "../types/entity.types.ts";
import type { ReadonlyRawEntityViews } from "../types/readonly-buffer.types.ts";
import { parseColor } from "../utils/color.utils.ts";

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
    }
    return id;
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
   * The underlying Wasm buffer, for Wasm-side systems such as culling.
   * @internal Mutating it directly bypasses dirty tracking.
   */
  getRawWasmBuffer(): EntityBuffer {
    return this.buffer;
  }

  getActiveCount(): number {
    return this.buffer.active_count();
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
