import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Camera, initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { CameraController } from "../scene/camera-controller.ts";
import { EntityManager } from "../scene/entity-manager.ts";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";

/**
 * Drives the whole stack in sequence: real Wasm ECS + camera -> TypeScript
 * facade -> renderer against a mock WebGPU device. Tests share one scene and
 * depend on running in order.
 */
describe("engine end-to-end guarantees", () => {
  let InstancedRenderer: typeof import("../renderer/instanced-renderer.ts").InstancedRenderer;
  let manager: EntityManager;
  let renderer: InstanceType<typeof InstancedRenderer>;
  let camera: Camera;
  let device: ReturnType<typeof createMockDevice>;
  let uniformBuffer: { size: number };
  const ids: number[] = [];

  const wasmBuffer = () => (wasm_memory() as WebAssembly.Memory).buffer;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const instanceWrites = () => device.writes.filter((w) => w.buffer !== uniformBuffer);
  const uniformWrites = () => device.writes.filter((w) => w.buffer === uniformBuffer);
  const bytes = (writes: { data: Float32Array | Uint32Array }[]) =>
    writes.reduce((total, w) => total + w.data.byteLength, 0);
  const lastPass = () => device.passes[device.passes.length - 1]!;

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ InstancedRenderer } = await import("../renderer/instanced-renderer.ts"));

    manager = new EntityManager(2); // deliberately tiny to force heap growth
    device = createMockDevice();
    renderer = new InstancedRenderer(
      createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }),
      2,
    );
    uniformBuffer = device.buffers.find((b) => b.size === 64)!;
    camera = new Camera(1.5);
  });

  it("Guarantee 1: growing past the initial capacity preserves every entity's data", () => {
    const initialCapacity = manager.getCapacity();
    for (let i = 0; i < 6; i++) {
      ids.push(
        manager.createEntity({
          position: { x: i * 10, y: i * 10 + 1, z: i * 10 + 2 },
          scale: { x: i + 1, y: i + 1, z: i + 1 },
          color: i % 2 === 0 ? "#ff0000" : "#00ff00",
        }),
      );
    }

    assert.ok(manager.getCapacity() > initialCapacity, "capacity should have grown");
    assert.equal(manager.getActiveCount(), 6);

    const { positions, scales, colors } = manager.getRawViews();
    assert.equal(positions.buffer, wasmBuffer(), "views must alias Wasm memory (zero-copy)");
    assert.deepEqual(
      [...positions],
      Array.from({ length: 6 }, (_, i) => [i * 10, i * 10 + 1, i * 10 + 2]).flat(),
    );
    assert.deepEqual([...scales], Array.from({ length: 6 }, (_, i) => [i + 1, i + 1, i + 1]).flat());
    assert.equal(colors[0], 1);
    assert.equal(colors[3 + 1], 1); // entity 1 is green
  });

  it("Guarantee 2: removing an inner entity compacts the array and marks the swapped slot dirty", () => {
    renderer.render(manager); // flush the initial dirty state
    device.writes.length = 0;

    manager.removeEntity(ids[1]!); // entity 5 (the last) is swapped into dense slot 1

    assert.equal(manager.getActiveCount(), 5);
    const { positions } = manager.getRawViews();
    assert.equal(positions.length, 15, "no holes: exactly 5 entities remain");
    assert.deepEqual([...positions.subarray(3, 6)], [50, 51, 52]);

    const dirty = manager.getDirtyTracker();
    for (const channel of ["position", "scale", "color"] as const) {
      assert.deepEqual(dirty.getRange(channel, 5), { min: 1, max: 1 });
    }
  });

  it("Guarantee 3: unchanged frames upload 0 instance bytes; one color edit uploads one 12-byte slice", () => {
    renderer.render(manager); // flushes the swap from Guarantee 2
    device.writes.length = 0;

    renderer.render(manager); // nothing changed
    assert.equal(instanceWrites().length, 0);
    assert.equal(bytes(instanceWrites()), 0);

    // ids[2] was not touched by the swap, so it still lives in dense slot 2.
    manager.updateEntity(ids[2]!, { color: "#0000ff" });
    renderer.render(manager);

    assert.equal(instanceWrites().length, 1);
    const [write] = instanceWrites();
    assert.equal(write!.offset, 2 * 12, "byteOffset = dense index 2 * 12 bytes");
    assert.equal(write!.data.length, 3);
    assert.equal(write!.data.byteLength, 12);
    assert.deepEqual([...write!.data], [0, 0, 1]);
    assert.equal(write!.data.buffer, wasmBuffer());
  });

  it("Guarantee 4: panning and zooming the camera uploads only the 64-byte uniform", () => {
    renderer.updateCamera(camera); // first camera upload
    renderer.render(manager);
    device.writes.length = 0;

    camera.pan_2d(10, 20);
    camera.set_ortho_zoom(50);
    renderer.updateCamera(camera);
    renderer.render(manager);

    assert.equal(bytes(uniformWrites()), 64);
    assert.equal(uniformWrites().length, 1);
    assert.equal(uniformWrites()[0]!.data.length, 16);
    assert.equal(uniformWrites()[0]!.data.buffer, wasmBuffer());
    assert.equal(uniformWrites()[0]!.data.byteOffset, camera.view_proj_ptr());
    assert.equal(bytes(instanceWrites()), 0);
    assert.equal(device.writes.length, 1);

    // The uploaded matrix really encodes the new view: world (10, 20, 0) is the screen center.
    const m = uniformWrites()[0]!.data;
    const clipX = m[0]! * 10 + m[4]! * 20 + m[12]!;
    const clipY = m[1]! * 10 + m[5]! * 20 + m[13]!;
    assert.ok(close(clipX, 0) && close(clipY, 0));
  });

  it("Guarantee 5: each frame binds group 0 and issues exactly one instanced draw", () => {
    const passesBefore = device.passes.length;
    renderer.render(manager);
    renderer.render(manager);

    assert.equal(device.passes.length, passesBefore + 2);
    for (const pass of device.passes.slice(passesBefore)) {
      const methods = pass.calls.map((c) => c.method);
      assert.equal(methods.filter((m) => m === "draw").length, 1);
      const bind = pass.calls.find((c) => c.method === "setBindGroup")!;
      assert.equal(bind.args[0], 0);
      assert.deepEqual(pass.calls.find((c) => c.method === "draw")!.args, [
        6,
        manager.getActiveCount(),
        0,
        0,
      ]);
      assert.ok(methods.indexOf("setBindGroup") < methods.indexOf("draw"));
    }
    assert.equal(lastPass().calls.filter((c) => c.method === "setVertexBuffer").length, 4);
  });

  it("Guarantee 6: CameraController uploads the 64-byte uniform only when the camera changed", () => {
    const controller = new CameraController({ aspect: 1.5 });
    assert.equal(controller.syncIfDirty(renderer), true);
    renderer.render(manager);
    device.writes.length = 0;

    assert.equal(controller.syncIfDirty(renderer), false);
    renderer.render(manager);
    assert.equal(device.writes.length, 0, "clean camera and scene: 0 bytes uploaded");

    controller.panByPixels(30, -10, 600);
    assert.equal(controller.syncIfDirty(renderer), true);
    renderer.render(manager);

    assert.equal(bytes(uniformWrites()), 64);
    assert.equal(bytes(instanceWrites()), 0);
  });
});
