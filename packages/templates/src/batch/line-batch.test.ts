import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

describe("LineBatch", () => {
  let LineBatch: typeof import("./line-batch.ts").LineBatch;
  let device: ReturnType<typeof createMockDevice>;

  const memory = () => wasm_memory() as WebAssembly.Memory;
  const writesTo = (buffer: GPUBuffer) => device.writes.filter((w) => w.buffer === buffer as unknown);

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ LineBatch } = await import("./line-batch.ts"));
  });

  beforeEach(() => {
    device = createMockDevice();
  });

  it("allocates GPU buffers for two vertices per segment", () => {
    const lines = new LineBatch(device, 50);

    assert.equal(lines.capacity, 50);
    assert.equal(lines.verticesBuffer.size, 50 * 24);
    assert.equal(lines.colorsBuffer.size, 50 * 8);
    assert.equal(lines.sync(), 0);
    assert.equal(device.writes.length, 0);
  });

  it("uploads new segments zero-copy, then nothing while clean", () => {
    const lines = new LineBatch(device, 10);
    lines.setSegment(0, 1, 2, 3, 4, 5, 6);
    lines.setSegmentColors(0, 0xff0000ff, 0xff00ff00);
    lines.setCount(1);

    assert.equal(lines.sync(), 1);
    const [vertices] = writesTo(lines.verticesBuffer);
    assert.deepEqual([...vertices!.data], [1, 2, 3, 4, 5, 6]);
    assert.equal(vertices!.data.buffer, memory().buffer);
    assert.deepEqual([...writesTo(lines.colorsBuffer)[0]!.data], [0xff0000ff, 0xff00ff00]);

    device.writes.length = 0;
    lines.sync();
    assert.equal(device.writes.length, 0);
  });

  it("moving a few segments uploads only their span", () => {
    const lines = new LineBatch(device, 100);
    lines.setCount(100);
    lines.sync();
    device.writes.length = 0;

    lines.setSegment(40, 0, 0, 0, 1, 1, 1);
    lines.setSegment(42, 0, 0, 0, 2, 2, 2);
    lines.sync();

    assert.equal(device.writes.length, 1, "vertices only, colors untouched");
    assert.equal(device.writes[0]!.offset, 40 * 24);
    assert.equal(device.writes[0]!.data.length, 3 * 6);
  });

  it("direct view writes plus markDirty upload the marked channel", () => {
    const lines = new LineBatch(device, 4);
    lines.setCount(4);
    lines.sync();
    device.writes.length = 0;

    lines.getColors().set([1, 2], 2 * 2);
    lines.markDirty(2, 2, ["color"]);
    lines.sync();

    assert.equal(device.writes.length, 1);
    assert.equal(device.writes[0]!.offset, 2 * 8);
    assert.deepEqual([...device.writes[0]!.data], [1, 2]);
  });

  it("views survive Wasm memory growth", () => {
    const lines = new LineBatch(device, 4);
    lines.setSegment(3, 1, 1, 1, 2, 2, 2);
    const before = lines.getVertices();

    memory().grow(1);

    assert.equal(before.byteLength, 0);
    assert.deepEqual([...lines.getVertices().subarray(18, 24)], [1, 1, 1, 2, 2, 2]);
  });

  it("destroy frees both GPU buffers", () => {
    const lines = new LineBatch(device, 4);
    lines.destroy();

    assert.equal((lines.verticesBuffer as unknown as { destroyed: boolean }).destroyed, true);
    assert.equal((lines.colorsBuffer as unknown as { destroyed: boolean }).destroyed, true);
  });
});
