import { CullingBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import { FLOATS_PER_VEC3 } from "../memory/vec3-layout.ts";
import type { VisibleViews } from "../types/culling.types.ts";
import type { CameraController } from "./camera-controller.ts";
import type { EntityManager } from "./entity-manager.ts";

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
   * Whole-scene trivial accept in O(1): whether every entity is certainly
   * inside the camera frustum (the scene's bounding sphere or box lies inside
   * all six planes), so a per-entity cull would keep everything and can be
   * skipped.
   *
   * Bounds only grow between recomputes; when a grown volume fails the test,
   * it is recomputed exactly (one O(n) pass) and tested again, so looseness
   * never costs a missed trivial accept.
   */
  isSceneFullyVisible(entityManager: EntityManager, cameraController: CameraController): boolean {
    if (entityManager.getActiveCount() === 0) {
      return true;
    }
    const camera = cameraController.getRawWasmCamera();
    const bounds = entityManager.getSceneBounds();
    if (bounds.usable && CullingBuffer.bounds_fully_visible(camera, bounds.toArray())) {
      return true;
    }
    if (!bounds.grown) {
      return false;
    }
    entityManager.recomputeSceneBounds();
    return bounds.usable && CullingBuffer.bounds_fully_visible(camera, bounds.toArray());
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
