import { CullingBuffer, SceneVisibility, wasm_memory } from "@engine/core/pkg/engine.js";
import { FLOATS_PER_VEC3 } from "../memory/vec3-layout.ts";
import type { VisibleViews } from "../types/culling.types.ts";
import type { CameraController } from "./camera-controller.ts";
import type { EntityManager } from "./entity-manager.ts";

/** Where the whole scene stands relative to the camera frustum. */
export type SceneVisibilityClass = "visible" | "hidden" | "partial";

const VISIBILITY_CLASSES: Record<SceneVisibility, SceneVisibilityClass> = {
  [SceneVisibility.Hidden]: "hidden",
  [SceneVisibility.Partial]: "partial",
  [SceneVisibility.Visible]: "visible",
};

/**
 * Runs frustum culling in Wasm and exposes the compacted visible set as
 * zero-copy views. The Wasm module must be initialized first.
 */
export class CullingManager {
  private readonly wasmCulling: CullingBuffer;
  private readonly wasmMemoryFn: () => WebAssembly.Memory;

  constructor(
    initialCapacity: number = 1000,
    wasmMemoryFn: () => WebAssembly.Memory = () => wasm_memory() as WebAssembly.Memory,
  ) {
    this.wasmCulling = new CullingBuffer(initialCapacity);
    this.wasmMemoryFn = wasmMemoryFn;
  }

  /**
   * Whole-scene trivial accept / reject in O(1), from the scene's bounding
   * volume (a sphere and a box around every entity):
   *
   * - `'visible'`: everything is inside the frustum; skip the per-entity cull.
   * - `'hidden'`: everything is outside; draw nothing, skip the cull.
   * - `'partial'`: the scene straddles the frustum; cull per entity.
   *
   * Bounds only grow between recomputes. When a grown volume can only be
   * classified `'partial'`, it is recomputed exactly (one O(n) pass) and
   * classified again, so looseness never costs a missed fast path.
   */
  classifyScene(entityManager: EntityManager, cameraController: CameraController): SceneVisibilityClass {
    if (entityManager.getActiveCount() === 0) {
      return "hidden";
    }
    const camera = cameraController.getRawWasmCamera();
    const bounds = entityManager.getSceneBounds();
    const classify = () =>
      bounds.usable ? VISIBILITY_CLASSES[CullingBuffer.classify_bounds(camera, bounds.toArray())] : "partial";
    const first = classify();
    if (first !== "partial" || !bounds.grown) {
      return first;
    }
    entityManager.recomputeSceneBounds();
    return classify();
  }

  /** Culls against the camera's frustum and returns the visible count. */
  cullEntities(
    entityManager: EntityManager,
    cameraController: CameraController,
  ): number {
    return this.wasmCulling.cull(
      entityManager.getRawWasmBuffer(),
      cameraController.getRawWasmCamera(),
    );
  }

  /** Frees the Wasm culling buffers. The manager must not be used afterwards. */
  destroy(): void {
    this.wasmCulling.free();
  }

  /**
   * Views of the last cull's result. They are rebuilt on every call because the
   * Wasm arrays can move whenever a cull grows them.
   */
  getVisibleViews(): VisibleViews {
    const visibleCount = this.wasmCulling.visible_count();
    const buffer = this.wasmMemoryFn().buffer;
    const length = visibleCount * FLOATS_PER_VEC3;
    return {
      positions: new Float32Array(buffer, this.wasmCulling.visible_positions_ptr(), length),
      scales: new Float32Array(buffer, this.wasmCulling.visible_scales_ptr(), length),
      colors: new Float32Array(buffer, this.wasmCulling.visible_colors_ptr(), length),
      visibleCount,
    };
  }
}
