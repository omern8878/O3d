import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import { EntityManager } from "../scene/entity-manager.ts";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

describe("dirty range uploads (real Wasm EntityManager + GpuInstanceBuffers)", () => {
  let GpuInstanceBuffers: typeof import("./gpu-buffer-sync.ts").GpuInstanceBuffers;

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ GpuInstanceBuffers } = await import("./gpu-buffer-sync.ts"));
  });

  function createScene(entityCount: number, capacity = 8) {
    const manager = new EntityManager(capacity);
    const ids = Array.from({ length: entityCount }, (_, i) =>
      manager.createEntity({ position: { x: i, y: i, z: i }, color: "#ff0000" }),
    );
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, capacity);
    return { manager, ids, device, buffers };
  }

  it("frame 1 uploads once per channel, frame 2 uploads nothing, frame 3 uploads only the changed color slice", () => {
    const { manager, ids, device, buffers } = createScene(3);

    // Frame 1: three new entities -> one write per channel covering indices 0..2.
    assert.equal(buffers.syncFromEntities(manager), 3);
    assert.equal(device.writes.length, 3);
    assert.deepEqual(
      device.writes.map((w) => w.buffer),
      [buffers.positionsBuffer, buffers.scalesBuffer, buffers.colorsBuffer],
    );
    for (const write of device.writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 9);
    }

    // Frame 2: nothing changed -> zero writes.
    device.writes.length = 0;
    assert.equal(buffers.syncFromEntities(manager), 3);
    assert.equal(device.writes.length, 0);

    // Frame 3: update only the color of the entity at dense index 1.
    manager.updateEntity(ids[1]!, { color: "#00ff00" });
    assert.equal(buffers.syncFromEntities(manager), 3);
    assert.equal(device.writes.length, 1);
    const [write] = device.writes;
    assert.equal(write!.buffer, buffers.colorsBuffer);
    assert.equal(write!.offset, 12);
    assert.equal(write!.data.length, 3);
    assert.deepEqual([...write!.data], [0, 1, 0]);
    // Still a zero-copy view: 12 bytes into the colors array in Wasm memory.
    assert.equal(write!.data.byteOffset, manager.getRawViews().colors.byteOffset + 12);
  });

  it("re-uploads everything when the GPU buffers are reallocated", () => {
    const manager = new EntityManager(2);
    const device = createMockDevice();
    const buffers = new GpuInstanceBuffers(device, 2);
    for (let i = 0; i < 2; i++) manager.createEntity();
    buffers.syncFromEntities(manager);
    device.writes.length = 0;

    manager.createEntity(); // Wasm capacity grows past the GPU capacity.
    assert.equal(buffers.syncFromEntities(manager), 3);

    assert.equal(device.writes.length, 3);
    for (const write of device.writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 9);
    }
  });

  it("uploads the swapped-in slot after removing a non-last entity", () => {
    const { manager, ids, device, buffers } = createScene(3);
    buffers.syncFromEntities(manager);
    device.writes.length = 0;

    manager.removeEntity(ids[0]!); // last entity is swapped into dense index 0

    assert.equal(buffers.syncFromEntities(manager), 2);
    assert.equal(device.writes.length, 3);
    for (const write of device.writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, 3);
    }
  });

  it("uploads nothing after removing the last entity", () => {
    const { manager, ids, device, buffers } = createScene(3);
    buffers.syncFromEntities(manager);
    device.writes.length = 0;

    manager.removeEntity(ids[2]!);

    assert.equal(buffers.syncFromEntities(manager), 2);
    assert.equal(device.writes.length, 0);
  });

  it("widens a channel's range to cover several updated entities", () => {
    const { manager, ids, device, buffers } = createScene(4);
    buffers.syncFromEntities(manager);
    device.writes.length = 0;

    manager.updateEntity(ids[3]!, { position: { x: 9 } });
    manager.updateEntity(ids[1]!, { position: { y: 9 } });

    buffers.syncFromEntities(manager);

    assert.equal(device.writes.length, 1);
    assert.equal(device.writes[0]!.buffer, buffers.positionsBuffer);
    assert.equal(device.writes[0]!.offset, 12);
    assert.equal(device.writes[0]!.data.length, 9);
  });
});
