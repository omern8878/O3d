import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";

/**
 * Whole-scene trivial accept through InstancedRenderer.renderCulled: when the
 * scene's bounds lie inside the frustum, the per-entity cull is skipped.
 */
describe("whole-scene frustum trivial accept", () => {
  let InstancedRenderer: typeof import("../renderer/instanced-renderer.ts").InstancedRenderer;
  let EntityManager: typeof import("../scene/entity-manager.ts").EntityManager;
  let CameraController: typeof import("../scene/camera-controller.ts").CameraController;
  let CullingManager: typeof import("../scene/culling-manager.ts").CullingManager;

  before(async () => {
    installMockGpuGlobals();
    initSync({ module: readFileSync(fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"))) });
    ({ InstancedRenderer } = await import("../renderer/instanced-renderer.ts"));
    ({ EntityManager } = await import("../scene/entity-manager.ts"));
    ({ CameraController } = await import("../scene/camera-controller.ts"));
    ({ CullingManager } = await import("../scene/culling-manager.ts"));
  });

  /** A flat 9 x 9 grid in x, y in [-80, 80] and a 2D camera seeing [-100, 100]. */
  function setup() {
    const entities = new EntityManager(81);
    for (let i = 0; i < 81; i++) {
      entities.createEntity({
        position: { x: (i % 9) * 20 - 80, y: Math.floor(i / 9) * 20 - 80, z: 0 },
        scale: { x: 2, y: 2, z: 1 },
      });
    }
    const camera = new CameraController({ aspect: 1 });
    const culling = new CullingManager(81);
    let culls = 0;
    const cull = culling.cullEntities.bind(culling);
    culling.cullEntities = (e, c) => {
      culls++;
      return cull(e, c);
    };
    const device = createMockDevice();
    const renderer = new InstancedRenderer(createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }), 81);
    const frame = () => renderer.renderCulled(entities, camera, culling);
    return { entities, camera, culling, renderer, frame, culls: () => culls };
  }

  it("skips the per-entity cull while the whole scene is in view, even as the camera moves", () => {
    const { camera, frame, culls } = setup();

    assert.equal(frame(), 81);
    camera.panByPixels(3, 2, 800);
    assert.equal(frame(), 81);
    camera.zoom(0.95);
    assert.equal(frame(), 81);

    assert.equal(culls(), 0);
  });

  it("keeps dirty uploads to the edited slice on the trivially accepted path", () => {
    const { entities, renderer, frame } = setup();
    frame();

    entities.updateEntity(40, { position: { x: 1, y: 1 } });
    frame();

    assert.deepEqual(renderer.getLastFrameUploads(), [{ channel: "position", byteOffset: 40 * 12, byteLength: 12 }]);
  });

  it("culls per entity once part of the scene leaves the view", () => {
    const { camera, frame, culls } = setup();
    frame();

    camera.zoom(0.5); // sees x, y in [-50, 50]: a 5 x 5 block of the grid

    assert.equal(frame(), 25);
    assert.equal(culls(), 1);
  });

  it("an entity moved out of view is culled; moving it back restores the fast path", () => {
    const { entities, frame, culls } = setup();
    frame();

    entities.updateEntity(0, { position: { x: 5000 } });
    assert.equal(frame(), 80);
    assert.equal(culls(), 1);

    // The bounds grew to reach x = 5000; returning the entity leaves them
    // loose, and the exact recompute makes the trivial accept succeed again.
    entities.updateEntity(0, { position: { x: -80 } });
    assert.equal(frame(), 81);
    assert.equal(culls(), 1, "no second per-entity cull");
    assert.equal(entities.getSceneBounds().grown, false);
  });

  it("a scene with non-finite data always takes the per-entity cull", () => {
    const { entities, frame, culls } = setup();
    entities.updateEntity(3, { position: { x: Number.NaN } });

    frame();
    assert.equal(culls(), 1);
  });
});
