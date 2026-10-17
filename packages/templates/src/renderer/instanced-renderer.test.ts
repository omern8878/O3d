import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { EntityManager } from "../scene/entity-manager.ts";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";
import { INSTANCED_QUAD_WGSL } from "./shaders/instanced-quad.wgsl.ts";

const CLEAR_COLOR = { r: 0.1, g: 0.2, b: 0.3, a: 1 };

describe("InstancedRenderer", () => {
  let InstancedRenderer: typeof import("./instanced-renderer.ts").InstancedRenderer;

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ InstancedRenderer } = await import("./instanced-renderer.ts"));
  });

  function createScene() {
    const manager = new EntityManager(2);
    manager.createEntity({
      position: { x: 0.1, y: 0.2, z: 0.3 },
      scale: { x: 1, y: 1, z: 1 },
      color: "#ff0000",
    });
    manager.createEntity({
      position: { x: 0.4, y: 0.5, z: 0.6 },
      scale: { x: 2, y: 2, z: 2 },
      color: "#00ff00",
    });
    manager.createEntity({
      position: { x: 0.7, y: 0.8, z: 0.9 },
      scale: { x: 3, y: 3, z: 3 },
      color: "#0000ff",
    });
    const device = createMockDevice();
    const renderer = new InstancedRenderer(createMockGpuContext(device, CLEAR_COLOR), 2);
    return { manager, device, renderer };
  }

  it("builds a pipeline with 4 vertex layouts, triangle-list and no culling", () => {
    const { device } = createScene();

    assert.equal(device.shaderModules[0]!.code, INSTANCED_QUAD_WGSL);
    const pipeline = device.pipelines[0]!;
    const buffers = [...pipeline.vertex.buffers!] as GPUVertexBufferLayout[];

    assert.deepEqual(
      buffers.map((b) => [b.attributes[0]!.shaderLocation, b.attributes[0]!.format, b.arrayStride, b.stepMode]),
      [
        [0, "float32x2", 8, "vertex"],
        [1, "float32x3", 12, "instance"],
        [2, "float32x3", 12, "instance"],
        [3, "float32x3", 12, "instance"],
      ],
    );
    assert.equal(pipeline.primitive!.topology, "triangle-list");
    assert.equal(pipeline.primitive!.cullMode, "none");
  });

  it("uploads the exact Wasm views and draws all instances in one call", () => {
    const { manager, device, renderer } = createScene();

    const drawn = renderer.render(manager);

    assert.equal(drawn, 3);

    // Zero-copy: each upload is a view straight over Wasm linear memory.
    const memory = (wasm_memory() as WebAssembly.Memory).buffer;
    const expected = [
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      [1, 1, 1, 2, 2, 2, 3, 3, 3],
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ];
    // Write 0 is the one-time quad upload; the next three are the instance data.
    assert.equal(device.writes.length, 4);
    assert.equal(device.writes[0]!.data.length, 12);
    const uploads = device.writes.slice(1);
    uploads.forEach((write, i) => {
      assert.equal(write.data.buffer, memory);
      assert.equal(write.data.length, 9);
      assert.equal(write.offset, 0);
      expected[i]!.forEach((value, j) => assert.ok(Math.abs(write.data[j]! - value) < 1e-6));
    });
    const raw = manager.getRawViews();
    assert.equal(uploads[0]!.data.byteOffset, raw.positions.byteOffset);
    assert.equal(uploads[1]!.data.byteOffset, raw.scales.byteOffset);
    assert.equal(uploads[2]!.data.byteOffset, raw.colors.byteOffset);

    // Exactly one render pass with exactly one draw call: draw(6, 3, 0, 0).
    assert.equal(device.passes.length, 1);
    const calls = device.passes[0]!.calls;
    assert.deepEqual(calls.filter((c) => c.method === "draw"), [
      { method: "draw", args: [6, 3, 0, 0] },
    ]);
    assert.deepEqual(
      calls.map((c) => c.method),
      ["setPipeline", "setVertexBuffer", "setVertexBuffer", "setVertexBuffer", "setVertexBuffer", "draw", "end"],
    );
    assert.equal(device.submitCount, 1);
  });

  it("binds quad and instance buffers to slots 0..3", () => {
    const { manager, device, renderer } = createScene();
    renderer.render(manager);

    const bindings = device.passes[0]!.calls
      .filter((c) => c.method === "setVertexBuffer")
      .map((c) => c.args as [number, { size: number }]);

    assert.deepEqual(bindings.map(([slot]) => slot), [0, 1, 2, 3]);
    assert.equal(bindings[0]![1].size, 12 * 4);
    // Capacity grew from 2 to 4 entities, so instance buffers are 4 * 12 bytes.
    for (const [, buffer] of bindings.slice(1)) assert.equal(buffer.size, 4 * 12);
  });

  it("clears with the context clear color and skips the draw when empty", () => {
    const device = createMockDevice();
    const renderer = new InstancedRenderer(createMockGpuContext(device, CLEAR_COLOR), 4);

    const drawn = renderer.render(new EntityManager(4));

    assert.equal(drawn, 0);
    const pass = device.passes[0]!;
    const attachment = [...pass.descriptor.colorAttachments][0]!;
    assert.deepEqual(attachment.clearValue, CLEAR_COLOR);
    assert.equal(attachment.loadOp, "clear");
    assert.equal(attachment.storeOp, "store");
    assert.deepEqual(pass.calls.map((c) => c.method), ["end"]);
    assert.equal(device.submitCount, 1);
  });

  it("destroy() frees quad and instance buffers", () => {
    const { device, renderer } = createScene();
    renderer.destroy();

    assert.ok(device.buffers.every((b) => b.destroyed));
  });
});
