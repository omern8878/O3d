import { ScenePicker } from "@engine/core/pkg/engine.js";
import type { EntityId } from "../types/entity.types.ts";
import type { ViewportRect } from "../types/picking.types.ts";
import type { CameraController } from "./camera-controller.ts";
import type { EntityManager } from "./entity-manager.ts";

/**
 * Finds the entity under a screen point by casting a ray through the camera
 * into the scene (done in Wasm). The nearest entity along the ray wins.
 *
 * Entities are picked as spheres of radius `0.5 * largest scale component`.
 * The Wasm module must be initialized before constructing a controller.
 */
export class PickingController {
  private readonly wasmPicker = new ScenePicker();

  /**
   * Picks at normalized device coordinates: `x` and `y` in `[-1, 1]`, with
   * `+Y` pointing up. Returns the entity's stable ID, or `null` if nothing is
   * there (including for non-finite coordinates).
   */
  pickByNdc(
    ndcX: number,
    ndcY: number,
    entityManager: EntityManager,
    cameraController: CameraController,
  ): EntityId | null {
    const id = this.wasmPicker.pick_ndc(
      entityManager.getRawWasmBuffer(),
      cameraController.getRawWasmCamera(),
      ndcX,
      ndcY,
    );
    return id >= 0 ? id : null;
  }

  /**
   * Picks at a pointer position, e.g. `event.clientX` / `event.clientY` with
   * the canvas's `getBoundingClientRect()`. Returns `null` for an empty
   * viewport or when nothing is under the pointer.
   */
  pickAtScreenCoords(
    clientX: number,
    clientY: number,
    viewportRect: ViewportRect,
    entityManager: EntityManager,
    cameraController: CameraController,
  ): EntityId | null {
    const { left, top, width, height } = viewportRect;
    if (!(width > 0) || !(height > 0)) {
      return null;
    }

    const ndcX = ((clientX - left) / width) * 2 - 1;
    // Screen Y grows downwards while NDC Y grows upwards.
    const ndcY = 1 - ((clientY - top) / height) * 2;
    return this.pickByNdc(ndcX, ndcY, entityManager, cameraController);
  }
}
