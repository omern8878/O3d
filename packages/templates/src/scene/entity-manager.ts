import { EntityBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import { WasmBufferView } from "../memory/wasm-buffer-view.ts";
import type {
  EntityId,
  EntityTransform,
  RawEntityViews,
} from "../types/entity.types.ts";
import { parseColor } from "../utils/color.utils.ts";

const FLOATS_PER_VEC3 = 3;

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
    if (initial && denseIdx !== undefined) {
      this.applyTransform(denseIdx, initial);
    }
    return id;
  }

  /** Updates the provided fields of an entity. Unknown IDs are ignored. */
  updateEntity(id: EntityId, transform: EntityTransform): void {
    const denseIdx = this.buffer.get_dense_index(id);
    if (denseIdx === undefined) {
      return;
    }
    this.applyTransform(denseIdx, transform);
  }

  /** Removes an entity. Unknown IDs are ignored. */
  removeEntity(id: EntityId): void {
    this.buffer.remove_entity(id);
  }

  getActiveCount(): number {
    return this.buffer.active_count();
  }

  getCapacity(): number {
    return this.buffer.capacity();
  }

  /**
   * Zero-copy views trimmed to the active entities, for read-only verification.
   * They alias Wasm memory and become stale after the buffer grows.
   */
  getRawViews(): RawEntityViews {
    const end = this.buffer.active_count() * FLOATS_PER_VEC3;
    return {
      positions: this.view.getPositionsView().subarray(0, end),
      scales: this.view.getScalesView().subarray(0, end),
      colors: this.view.getColorsView().subarray(0, end),
    };
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
