import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

const BYTES_PER_INSTANCE = 12;
const USAGE = 0x20 | 0x08;

type Source = Parameters<
  InstanceType<typeof import("./gpu-buffer-sync.ts").GpuInstanceBuffers>["syncFromEntities"]
>[0];

function fakeSource(activeCount: number, capacity: number): Source {
  const floats = (n: number) => new Float32Array(n * 3).map((_, i) => i + 1);
  return {
    getActiveCount: () => activeCount,
    getCapacity: () => capacity,
    getRawViews: () => ({
      positions: floats(activeCount),
      scales: floats(activeCount),
      colors: floats(activeCount),
    }),
  };
}

describe("GpuInstanceBuffers", () => {
  let GpuInstanceBuffers: typeof import("./gpu-buffer-sync.ts").GpuInstanceBuffers;

  before(async () => {
    installMockGpuGlobals();
    ({ GpuInstanceBuffers } = await import("./gpu-buffer-sync.ts"));
  });

  it("allocates three buffers of capacity * 3 * 4 bytes with VERTEX | COPY_DST", () => {
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 10);

    assert.equal(device.buffers.length, 3);
    for (const buffer of device.buffers) {
      assert.equal(buffer.size, 10 * BYTES_PER_INSTANCE);
      assert.equal(buffer.usage, USAGE);
    }
    assert.equal(buffers.gpuCapacity, 10);
  });

  it("allocates at least one instance of space for zero capacity", () => {
    const device = createMockDevice();
    new GpuInstanceBuffers(device, 0);

    assert.ok(device.buffers.every((b) => b.size === BYTES_PER_INSTANCE));
  });

  it("returns 0 and uploads nothing when there are no active entities", () => {
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 4);

    assert.equal(buffers.syncFromEntities(fakeSource(0, 4)), 0);
    assert.equal(device.writes.length, 0);
  });

  it("uploads the exact Wasm views to each buffer without reallocating", () => {
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 4);
    const source = fakeSource(2, 4);

    assert.equal(buffers.syncFromEntities(source), 2);

    assert.equal(device.buffers.length, 3);
    assert.deepEqual(
      device.writes.map((w) => w.buffer),
      [buffers.positionsBuffer, buffers.scalesBuffer, buffers.colorsBuffer],
    );
    for (const write of device.writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 6);
    }
  });

  it("destroys old buffers and reallocates when Wasm capacity grows", () => {
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 2);
    const oldBuffers = [...device.buffers];

    buffers.syncFromEntities(fakeSource(3, 8));

    assert.ok(oldBuffers.every((b) => b.destroyed));
    assert.equal(buffers.gpuCapacity, 8);
    assert.equal(device.buffers.length, 6);
    for (const buffer of device.buffers.slice(3)) {
      assert.equal(buffer.size, 8 * BYTES_PER_INSTANCE);
      assert.equal(buffer.destroyed, false);
    }
    assert.equal(device.writes[0]!.buffer, buffers.positionsBuffer);
  });

  it("never shrinks the GPU buffers", () => {
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 8);

    buffers.syncFromEntities(fakeSource(1, 2));

    assert.equal(buffers.gpuCapacity, 8);
    assert.equal(device.buffers.length, 3);
  });

  it("destroy() frees all three buffers", () => {
    const device = createMockDevice();
    new GpuInstanceBuffers(device, 2).destroy();

    assert.ok(device.buffers.every((b) => b.destroyed));
  });
});
