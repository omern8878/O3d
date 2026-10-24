import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Camera, initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { EntityManager } from "../scene/entity-manager.ts";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";

describe("camera uniform flow (real Wasm Camera + EntityManager + InstancedRenderer)", () => {
  let InstancedRenderer: typeof import("./instanced-renderer.ts").InstancedRenderer;

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ InstancedRenderer } = await import("./instanced-renderer.ts"));
  });

  function createScene() {
    const manager = new EntityManager(8);
    for (let i = 0; i < 3; i++) manager.createEntity({ position: { x: i } });
    const device = createMockDevice();
    const renderer = new InstancedRenderer(
      createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }),
      8,
    );
    const uniformBuffer = device.buffers.find((b) => b.size === 64)!;
    device.writes.length = 0; // forget constructor uploads (quad + identity camera)
    return { manager, device, renderer, uniformBuffer, camera: new Camera(1.5) };
  }

  const bytes = (writes: { data: Float32Array | Uint32Array }[]) =>
    writes.reduce((total, w) => total + w.data.byteLength, 0);

  it("initializes the camera uniform with the identity matrix", () => {
    const device = createMockDevice();
    new InstancedRenderer(createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }), 4);

    const cameraWrite = device.writes.find((w) => w.data.length === 16)!;
    assert.equal(cameraWrite.buffer.size, 64);
    assert.deepEqual(
      [...cameraWrite.data],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
  });

  it("declares a vertex-visible uniform at group 0 binding 0, shared by layout, pipeline and bind group", () => {
    const { device } = createScene();

    const [entry] = [...device.bindGroupLayouts[0]!.entries];
    assert.equal(entry!.binding, 0);
    assert.equal(entry!.visibility, 0x1);
    assert.deepEqual(entry!.buffer, { type: "uniform" });

    const layout = [...device.pipelineLayouts[0]!.bindGroupLayouts][0];
    assert.equal((layout as unknown as { descriptor: unknown }).descriptor, device.bindGroupLayouts[0]);
    assert.equal(device.bindGroups[0]!.layout, layout);
    assert.equal(
      (device.pipelines[0]!.layout as unknown as { descriptor: unknown }).descriptor,
      device.pipelineLayouts[0],
    );
  });

  it("updateCamera uploads exactly 64 bytes from Wasm memory to the uniform buffer", () => {
    const { device, renderer, uniformBuffer, camera } = createScene();

    renderer.updateCamera(camera);

    assert.equal(device.writes.length, 1);
    const [write] = device.writes;
    assert.equal(write!.buffer, uniformBuffer);
    assert.equal(write!.offset, 0);
    assert.equal(write!.data.length, 16);
    assert.equal(write!.data.byteLength, 64);
    assert.equal(write!.data.buffer, (wasm_memory() as WebAssembly.Memory).buffer);
    assert.equal(write!.data.byteOffset, camera.view_proj_ptr());
  });

  it("render binds group 0 and issues the instanced draw", () => {
    const { manager, device, renderer, camera } = createScene();
    renderer.updateCamera(camera);

    assert.equal(renderer.render(manager), 3);

    const calls = device.passes[0]!.calls;
    assert.deepEqual(calls.map((c) => c.method), [
      "setPipeline",
      "setBindGroup",
      "setVertexBuffer",
      "setVertexBuffer",
      "setVertexBuffer",
      "setVertexBuffer",
      "draw",
      "end",
    ]);
    const bind = calls.find((c) => c.method === "setBindGroup")!;
    assert.equal(bind.args[0], 0);
    assert.equal((bind.args[1] as { descriptor: unknown }).descriptor, device.bindGroups[0]);
    assert.deepEqual(calls.find((c) => c.method === "draw")!.args, [6, 3, 0, 0]);
  });

  it("panning the camera uploads only the 64-byte uniform, not instance data", () => {
    const { manager, device, renderer, uniformBuffer, camera } = createScene();
    renderer.updateCamera(camera);
    renderer.render(manager); // frame 1: uploads instances + camera
    device.writes.length = 0;

    camera.pan_2d(10, 20);
    renderer.updateCamera(camera);
    renderer.render(manager); // frame 2

    assert.equal(device.writes.length, 1);
    assert.equal(device.writes[0]!.buffer, uniformBuffer);
    assert.equal(bytes(device.writes), 64);
    const instanceWrites = device.writes.filter((w) => w.buffer !== uniformBuffer);
    assert.equal(bytes(instanceWrites), 0);
    assert.equal(device.passes.length, 2);
  });

  it("the uploaded matrix reflects the pan", () => {
    const { device, renderer, camera } = createScene();
    renderer.updateCamera(camera);
    const before = [...device.writes[0]!.data];

    camera.pan_2d(10, 20);
    renderer.updateCamera(camera);
    const after = [...device.writes[1]!.data];

    // Ortho 2D: clip-space translation (indices 12, 13) shifts by -dx/(half_h*aspect), -dy/half_h.
    assert.ok(Math.abs(after[12]! - before[12]! - -10 / (100 * 1.5)) < 1e-6);
    assert.ok(Math.abs(after[13]! - before[13]! - -20 / 100) < 1e-6);
  });

  it("destroy() also frees the camera uniform buffer", () => {
    const { device, renderer, uniformBuffer } = createScene();
    renderer.destroy();

    assert.equal(uniformBuffer.destroyed, true);
    assert.ok(device.buffers.every((b) => b.destroyed));
  });
});
