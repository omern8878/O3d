import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";

describe("CullingManager", () => {
  let CullingManager: typeof import("./culling-manager.ts").CullingManager;
  let CameraController: typeof import("./camera-controller.ts").CameraController;
  let EntityManager: typeof import("./entity-manager.ts").EntityManager;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ CullingManager } = await import("./culling-manager.ts"));
    ({ CameraController } = await import("./camera-controller.ts"));
    ({ EntityManager } = await import("./entity-manager.ts"));
  });

  /** Entities at x = 0, 500, -50, 800, 90: the 1st, 3rd and 5th are on screen. */
  function createScene() {
    const entities = new EntityManager(2); // small, so the Wasm buffer grows too
    [0, 500, -50, 800, 90].forEach((x, i) =>
      entities.createEntity({
        position: { x, y: i, z: 0 },
        scale: { x: 4, y: 4, z: 1 },
        color: { r: i / 10, g: 0.5, b: 1 },
      }),
    );
    // Aspect 1, half height 100: x and y in [-100, 100] are visible.
    return { entities, camera: new CameraController({ aspect: 1 }) };
  }

  it("returns how many entities are inside the frustum", () => {
    const { entities, camera } = createScene();

    assert.equal(new CullingManager(2).cullEntities(entities, camera), 3);
  });

  it("exposes the compacted visible data as exact-length zero-copy views", () => {
    const { entities, camera } = createScene();
    const culling = new CullingManager(2);
    culling.cullEntities(entities, camera);

    const views = culling.getVisibleViews();

    assert.equal(views.visibleCount, 3);
    for (const view of [views.positions, views.scales, views.colors]) {
      assert.equal(view.length, 9);
      assert.equal(view.buffer, (wasm_memory() as WebAssembly.Memory).buffer);
    }
    assert.deepEqual([...views.positions], [0, 0, 0, -50, 2, 0, 90, 4, 0]);
    assert.deepEqual([...views.scales], [4, 4, 1, 4, 4, 1, 4, 4, 1]);
    assert.deepEqual(
      [...views.colors].map((v) => Math.round(v * 100) / 100),
      [0, 0.5, 1, 0.2, 0.5, 1, 0.4, 0.5, 1],
    );
  });

  it("returns empty views when nothing is visible", () => {
    const { entities, camera } = createScene();
    camera.getRawWasmCamera().pan_2d(5000, 0);
    const culling = new CullingManager(2);

    assert.equal(culling.cullEntities(entities, camera), 0);
    const views = culling.getVisibleViews();
    assert.equal(views.visibleCount, 0);
    assert.equal(views.positions.length, 0);
  });

  it("follows the camera: panning changes the visible set", () => {
    const { entities, camera } = createScene();
    const culling = new CullingManager(2);
    camera.panByPixels(-500, 0, 200); // 1 world unit per pixel: camera moves +500 in x

    assert.equal(culling.cullEntities(entities, camera), 1);
    assert.deepEqual([...culling.getVisibleViews().positions], [500, 1, 0]);
  });

  it("re-reads the Wasm pointers after the result grows", () => {
    const { entities, camera } = createScene();
    const culling = new CullingManager(1); // forces the Wasm output to reallocate

    culling.cullEntities(entities, camera);

    assert.deepEqual([...culling.getVisibleViews().positions], [0, 0, 0, -50, 2, 0, 90, 4, 0]);
  });

  it("uses the injected memory accessor", () => {
    const { entities, camera } = createScene();
    let calls = 0;
    const culling = new CullingManager(2, () => {
      calls++;
      return wasm_memory() as WebAssembly.Memory;
    });
    culling.cullEntities(entities, camera);

    culling.getVisibleViews();

    assert.equal(calls, 1);
  });
});
