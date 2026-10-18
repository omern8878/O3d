import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { CameraController } from "../scene/camera-controller.ts";
import { CullingManager } from "../scene/culling-manager.ts";
import { EntityManager } from "../scene/entity-manager.ts";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";

const ENTITY_COUNT = 100;
const isVisible = (i: number) => i % 7 === 0; // 0, 7, ..., 98: 15 entities
const VISIBLE = Array.from({ length: ENTITY_COUNT }, (_, i) => i).filter(isVisible);

/** 100 entities; 15 are inside x, y in [-100, 100], 85 are far to the right. */
describe("frustum culling through InstancedRenderer.renderCulled", () => {
  let InstancedRenderer: typeof import("../renderer/instanced-renderer.ts").InstancedRenderer;
  let entities: EntityManager;
  let camera: CameraController;
  let culling: CullingManager;
  let device: ReturnType<typeof createMockDevice>;
  let renderer: InstanceType<typeof InstancedRenderer>;
  let uniformBuffer: object;

  const wasmBuffer = () => (wasm_memory() as WebAssembly.Memory).buffer;
  const instanceWrites = () => device.writes.filter((w) => w.buffer !== uniformBuffer);
  const uniformWrites = () => device.writes.filter((w) => w.buffer === uniformBuffer);
  const lastPass = () => device.passes[device.passes.length - 1]!;
  const draws = () => lastPass().calls.filter((c) => c.method === "draw");

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ InstancedRenderer } = await import("../renderer/instanced-renderer.ts"));

    entities = new EntityManager(16);
    for (let i = 0; i < ENTITY_COUNT; i++) {
      entities.createEntity({
        position: { x: isVisible(i) ? i - 50 : 1000 + i, y: i % 10, z: 0 },
        scale: { x: 2, y: 2, z: 1 },
        color: { r: i / 100, g: 0.5, b: 0.25 },
      });
    }
    camera = new CameraController({ aspect: 1 }); // sees x, y in [-100, 100]
    culling = new CullingManager(16);
    device = createMockDevice();
    renderer = new InstancedRenderer(createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }), 16);
    uniformBuffer = device.buffers.find((b) => b.size === 64)!;
    device.writes.length = 0;
  });

  it("uploads only the 15 visible entities and draws exactly 15 instances", () => {
    assert.equal(entities.getActiveCount(), 100);

    const drawn = renderer.renderCulled(entities, camera, culling);

    assert.equal(drawn, 15);
    const writes = instanceWrites();
    assert.equal(writes.length, 3);
    for (const write of writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 15 * 3, "15 entities, not 100");
      assert.equal(write.data.buffer, wasmBuffer(), "zero-copy from the culling output");
    }
    assert.deepEqual(
      [...writes[0]!.data],
      VISIBLE.flatMap((i) => [i - 50, i % 10, 0]),
    );
    assert.equal(uniformWrites().length, 1, "camera synced once");

    assert.equal(draws().length, 1);
    assert.deepEqual(draws()[0]!.args, [6, 15, 0, 0]);
    const bind = lastPass().calls.find((c) => c.method === "setBindGroup")!;
    assert.equal(bind.args[0], 0);
  });

  it("an unchanged culled frame still uploads the visible set but not the camera", () => {
    device.writes.length = 0;

    assert.equal(renderer.renderCulled(entities, camera, culling), 15);

    assert.equal(uniformWrites().length, 0);
    assert.equal(instanceWrites().length, 3);
    assert.deepEqual(draws()[0]!.args, [6, 15, 0, 0]);
  });

  it("zooming out so everything is visible switches to the dirty-tracked full upload", () => {
    camera.zoom(30); // half height 3000: all 100 entities are on screen
    device.writes.length = 0;

    assert.equal(renderer.renderCulled(entities, camera, culling), 100);

    const writes = instanceWrites();
    assert.equal(writes.length, 3);
    for (const write of writes) assert.equal(write.data.length, 100 * 3);
    assert.equal(uniformWrites().length, 1);
    assert.deepEqual(draws()[0]!.args, [6, 100, 0, 0]);
  });

  it("with everything visible and nothing changed, no instance data is uploaded", () => {
    device.writes.length = 0;

    assert.equal(renderer.renderCulled(entities, camera, culling), 100);

    assert.equal(device.writes.length, 0);
    assert.deepEqual(draws()[0]!.args, [6, 100, 0, 0]);
  });

  it("an entity edit while fully visible uploads only its slice", () => {
    entities.updateEntity(3, { color: "#ff0000" });
    device.writes.length = 0;

    renderer.renderCulled(entities, camera, culling);

    assert.equal(instanceWrites().length, 1);
    assert.equal(instanceWrites()[0]!.offset, 3 * 12);
    assert.equal(instanceWrites()[0]!.data.length, 3);
  });

  it("zooming back in re-culls to 15, then zooming out re-sends the full dense arrays", () => {
    camera.zoom(1 / 30);
    device.writes.length = 0;
    assert.equal(renderer.renderCulled(entities, camera, culling), 15);
    assert.deepEqual(draws()[0]!.args, [6, 15, 0, 0]);
    for (const write of instanceWrites()) assert.equal(write.data.length, 45);

    camera.zoom(30);
    device.writes.length = 0;
    assert.equal(renderer.renderCulled(entities, camera, culling), 100);

    // The buffers held the compacted subset, so every channel is re-uploaded in full.
    const writes = instanceWrites();
    assert.equal(writes.length, 3);
    for (const write of writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 300);
    }
    // ...including the edit made while the subset was not on the GPU.
    assert.deepEqual([...writes[2]!.data.subarray(9, 12)].map(Math.round), [1, 0, 0]);
  });

  it("a plain render() after a culled frame also restores the dense arrays", () => {
    camera.zoom(1 / 30);
    renderer.renderCulled(entities, camera, culling); // GPU now holds the 15-entity subset
    device.writes.length = 0;

    assert.equal(renderer.render(entities), 100);

    assert.equal(instanceWrites().length, 3);
    for (const write of instanceWrites()) assert.equal(write.data.length, 300);
  });

  it("with nothing visible it clears the screen, uploads nothing and skips the draw", () => {
    camera.getRawWasmCamera().pan_2d(1.0e6, 0);
    camera.setPosition(1.0e6, 0, 10);
    camera.setTarget(1.0e6, 0, 0);
    device.writes.length = 0;

    assert.equal(renderer.renderCulled(entities, camera, culling), 0);

    assert.equal(instanceWrites().length, 0);
    assert.equal(draws().length, 0);
    assert.deepEqual(lastPass().calls.map((c) => c.method), ["end"]);
  });
});
