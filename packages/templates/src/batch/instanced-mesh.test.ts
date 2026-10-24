import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

describe("InstancedMesh", () => {
  let InstancedMesh: typeof import("./instanced-mesh.ts").InstancedMesh;
  let GpuMesh: typeof import("../geometry/gpu-mesh.ts").GpuMesh;
  let CameraController: typeof import("../scene/camera-controller.ts").CameraController;
  let device: ReturnType<typeof createMockDevice>;

  const memory = () => wasm_memory() as WebAssembly.Memory;
  const writesTo = (buffer: GPUBuffer) => device.writes.filter((w) => w.buffer === buffer as unknown);

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ InstancedMesh } = await import("./instanced-mesh.ts"));
    ({ GpuMesh } = await import("../geometry/gpu-mesh.ts"));
    ({ CameraController } = await import("../scene/camera-controller.ts"));
  });

  beforeEach(() => {
    device = createMockDevice();
  });

  it("allocates capacity-sized GPU buffers once and starts with nothing to draw", () => {
    const sphere = GpuMesh.sphere(device);
    const batch = new InstancedMesh(device, sphere, 100);

    assert.equal(batch.capacity, 100);
    assert.equal(batch.getCount(), 0);
    assert.equal(batch.transformsBuffer.size, 100 * 16);
    assert.equal(batch.rotationsBuffer.size, 100 * 16);
    assert.equal(batch.colorsBuffer.size, 100 * 4);
    device.writes.length = 0;
    assert.equal(batch.sync(), 0);
    assert.equal(device.writes.length, 0);
  });

  it("exposes zero-copy views with the default slot values", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 2);

    assert.equal(batch.getTransforms().buffer, memory().buffer);
    assert.deepEqual([...batch.getTransforms()], [0, 0, 0, 1, 0, 0, 0, 1]);
    assert.deepEqual([...batch.getRotations().subarray(0, 4)], [0, 0, 0, 1]);
    assert.deepEqual([...batch.getColors()], [0xffffffff, 0xffffffff]);
  });

  it("growing the count uploads exactly the newly active instances, from Wasm memory", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    batch.getTransforms().set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    device.writes.length = 0;

    assert.equal(batch.setCount(2), 2);
    assert.equal(batch.sync(), 2);

    const [transforms] = writesTo(batch.transformsBuffer);
    assert.equal(transforms!.offset, 0);
    assert.deepEqual([...transforms!.data], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(transforms!.data.buffer, memory().buffer, "uploaded straight from Wasm");
    assert.equal(writesTo(batch.rotationsBuffer)[0]!.data.length, 8);
    assert.equal(writesTo(batch.colorsBuffer)[0]!.data.length, 2);

    device.writes.length = 0;
    batch.sync();
    assert.equal(device.writes.length, 0, "a clean frame uploads nothing");

    batch.setCount(5);
    batch.sync();
    for (const write of device.writes) {
      assert.equal(write.offset, 2 * (write.buffer === (batch.colorsBuffer as unknown) ? 4 : 16));
    }
  });

  it("setters upload only the touched channel and range", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    batch.setCount(10);
    batch.sync();
    device.writes.length = 0;

    batch.setPosition(3, 9, 8, 7);
    batch.setPosition(5, 1, 1, 1);
    batch.setColor(4, 0x11223344);
    batch.sync();

    const transforms = writesTo(batch.transformsBuffer);
    assert.equal(transforms.length, 1);
    assert.equal(transforms[0]!.offset, 3 * 16);
    assert.equal(transforms[0]!.data.length, 3 * 4, "instances 3..=5");
    assert.deepEqual([...transforms[0]!.data.subarray(0, 4)], [9, 8, 7, 1], "scale kept");
    assert.equal(writesTo(batch.rotationsBuffer).length, 0);
    assert.deepEqual([...writesTo(batch.colorsBuffer)[0]!.data], [0x11223344]);
  });

  it("direct view writes plus markDirty upload the marked channels only", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    batch.setCount(10);
    batch.sync();
    device.writes.length = 0;

    batch.getRotations().set([0, 0, 1, 0], 7 * 4);
    batch.markDirty(7, 7, ["rotation"]);
    batch.sync();

    assert.equal(device.writes.length, 1);
    assert.equal(device.writes[0]!.offset, 7 * 16);
    assert.deepEqual([...device.writes[0]!.data], [0, 0, 1, 0]);
  });

  it("dirty ranges past the active count are not uploaded", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    batch.setCount(3);
    batch.sync();
    device.writes.length = 0;

    batch.setPosition(8, 1, 2, 3);
    batch.sync();

    assert.equal(device.writes.length, 0);
  });

  it("views survive Wasm memory growth", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 4);
    const before = batch.getTransforms();
    batch.setPosition(1, 5, 6, 7);

    memory().grow(1);

    assert.equal(before.byteLength, 0, "the old view detached");
    assert.deepEqual([...batch.getTransforms().subarray(4, 8)], [5, 6, 7, 1]);
    batch.setCount(2);
    batch.sync();
    assert.equal(writesTo(batch.transformsBuffer).at(-1)!.data.byteLength, 32);
  });

  it("clamps the count and ignores negative values", () => {
    const batch = new InstancedMesh(device, GpuMesh.sphere(device), 4);

    assert.equal(batch.setCount(99), 4);
    assert.equal(batch.setCount(-3), 0);
  });

  it("raycasts and culls with the mesh's bounding radius times the instance scale", () => {
    const camera = new CameraController({ aspect: 1 }); // 2D, sees x, y in [-100, 100]
    const cone = GpuMesh.cone(device); // bounding radius ~0.707
    const batch = new InstancedMesh(device, cone, 4);
    batch.setCount(3);
    batch.setTransform(0, -50, 0, 0, 10);
    batch.setTransform(1, 50, 0, 0, 10);
    batch.setTransform(2, 500, 0, 0, 10);

    // World x = 56 is 6 units from instance 1: inside 0.707 * 10, outside 0.5 * 10.
    assert.equal(batch.raycastNdc(camera, 0.56, 0), 1);
    assert.equal(batch.raycastNdc(camera, 0, 0), -1);
    assert.deepEqual([...batch.visibleIndices(camera)], [0, 1]);
  });

  it("destroy frees its GPU buffers but not the shared mesh", () => {
    const sphere = GpuMesh.sphere(device);
    const batch = new InstancedMesh(device, sphere, 4);
    batch.destroy();

    for (const buffer of [batch.transformsBuffer, batch.rotationsBuffer, batch.colorsBuffer]) {
      assert.equal((buffer as unknown as { destroyed: boolean }).destroyed, true);
    }
    assert.equal((sphere.vertexBuffer as unknown as { destroyed: boolean }).destroyed, false);
  });
});

describe("GpuMesh", () => {
  before(() => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
  });

  it("uploads vertices and indices once and records the bounding radius", async () => {
    const { GpuMesh } = await import("../geometry/gpu-mesh.ts");
    const device = createMockDevice();
    const mesh = GpuMesh.sphere(device, 8, 4);

    assert.equal(mesh.vertexCount, 9 * 5);
    assert.equal(mesh.indexCount, (8 * 4 * 2 - 16) * 3);
    assert.ok(Math.abs(mesh.boundingRadius - 1) < 1e-5);
    assert.equal(device.writes.length, 2);
    assert.equal(device.writes[0]!.data.length, mesh.vertexCount * 6);
    assert.ok(device.writes[1]!.data instanceof Uint32Array);
    assert.equal(device.writes[1]!.data.length, mesh.indexCount);
  });

  it("builds a mesh from triangles and keeps an empty one drawable-safe", async () => {
    const { GpuMesh } = await import("../geometry/gpu-mesh.ts");
    const device = createMockDevice();
    const triangle = GpuMesh.fromTriangles(device, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    assert.equal(triangle.indexCount, 3);

    const empty = GpuMesh.fromTriangles(device, new Float32Array(0));
    assert.equal(empty.indexCount, 0);
    assert.equal(empty.vertexBuffer.size, 4);
  });
});
