import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";

describe("PickingController", () => {
  let PickingController: typeof import("./picking-controller.ts").PickingController;
  let CameraController: typeof import("./camera-controller.ts").CameraController;
  let EntityManager: typeof import("./entity-manager.ts").EntityManager;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ PickingController } = await import("./picking-controller.ts"));
    ({ CameraController } = await import("./camera-controller.ts"));
    ({ EntityManager } = await import("./entity-manager.ts"));
  });

  /**
   * Aspect-1 2D camera showing world x, y in [-100, 100]: NDC (x, y) maps to
   * world (100x, 100y). One entity sits in the upper-right quadrant.
   */
  function createScene() {
    const entities = new EntityManager(4);
    const target = entities.createEntity({
      position: { x: 50, y: 50, z: 0 },
      scale: { x: 10, y: 10, z: 1 },
    });
    return { entities, camera: new CameraController({ aspect: 1 }), target };
  }

  it("pickByNdc returns the EntityId under the point, or null", () => {
    const { entities, camera, target } = createScene();
    const picker = new PickingController();

    assert.equal(picker.pickByNdc(0.5, 0.5, entities, camera), target);
    assert.equal(picker.pickByNdc(-0.5, 0.5, entities, camera), null);
    assert.equal(picker.pickByNdc(0.5, -0.5, entities, camera), null);
  });

  it("pickAtScreenCoords flips screen Y so the top of the viewport is NDC +1", () => {
    const { entities, camera, target } = createScene();
    const picker = new PickingController();
    const rect = { left: 0, top: 0, width: 200, height: 200 };

    // The entity is at NDC (0.5, 0.5): right of center and ABOVE it on screen.
    assert.equal(picker.pickAtScreenCoords(150, 50, rect, entities, camera), target);
    assert.equal(picker.pickAtScreenCoords(150, 150, rect, entities, camera), null);
  });

  it("pickAtScreenCoords honors the viewport's offset and size", () => {
    const { entities, camera, target } = createScene();
    const picker = new PickingController();
    const rect = { left: 40, top: 20, width: 400, height: 400 };

    assert.equal(picker.pickAtScreenCoords(40 + 300, 20 + 100, rect, entities, camera), target);
    assert.equal(picker.pickAtScreenCoords(300, 100, rect, entities, camera), null);
  });

  it("pickAtScreenCoords converts pixels to NDC exactly", () => {
    const calls: [number, number][] = [];
    class Spy extends PickingController {
      override pickByNdc(x: number, y: number): number | null {
        calls.push([x, y]);
        return null;
      }
    }
    const { entities, camera } = createScene();
    const rect = { left: 10, top: 20, width: 100, height: 50 };

    new Spy().pickAtScreenCoords(10, 20, rect, entities, camera);
    new Spy().pickAtScreenCoords(110, 70, rect, entities, camera);
    new Spy().pickAtScreenCoords(60, 45, rect, entities, camera);

    assert.deepEqual(calls, [
      [-1, 1],
      [1, -1],
      [0, 0],
    ]);
  });

  it("returns null for an empty viewport or non-finite input", () => {
    const { entities, camera } = createScene();
    const picker = new PickingController();

    for (const rect of [
      { left: 0, top: 0, width: 0, height: 100 },
      { left: 0, top: 0, width: 100, height: 0 },
      { left: 0, top: 0, width: -5, height: 100 },
      { left: 0, top: 0, width: Number.NaN, height: 100 },
    ]) {
      assert.equal(picker.pickAtScreenCoords(50, 50, rect, entities, camera), null);
    }
    assert.equal(picker.pickByNdc(Number.NaN, 0, entities, camera), null);
    assert.equal(picker.pickByNdc(0, Number.POSITIVE_INFINITY, entities, camera), null);
  });

  it("picks nothing from an empty scene", () => {
    const picker = new PickingController();

    assert.equal(
      picker.pickByNdc(0, 0, new EntityManager(2), new CameraController({ aspect: 1 })),
      null,
    );
  });
});
