import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

const UNIFORM_COPY_DST = 0x40 | 0x08;

describe("CameraUniformBuffer", () => {
  let CameraUniformBuffer: typeof import("./camera-uniform-buffer.ts").CameraUniformBuffer;

  before(async () => {
    installMockGpuGlobals();
    ({ CameraUniformBuffer } = await import("./camera-uniform-buffer.ts"));
  });

  function create() {
    const device = createMockDevice();
    const layout = device.createBindGroupLayout({ entries: [] }) as GPUBindGroupLayout;
    const uniform = new CameraUniformBuffer(device, layout);
    return { device, layout, uniform };
  }

  it("allocates a 64-byte UNIFORM | COPY_DST buffer bound at binding 0", () => {
    const { device, layout, uniform } = create();

    assert.equal(device.buffers.length, 1);
    assert.equal(device.buffers[0]!.size, 64);
    assert.equal(device.buffers[0]!.usage, UNIFORM_COPY_DST);

    const descriptor = device.bindGroups[0]!;
    assert.equal(descriptor.layout, layout);
    const [entry] = [...descriptor.entries];
    assert.equal(entry!.binding, 0);
    assert.equal((entry!.resource as GPUBufferBinding).buffer, device.buffers[0]);
    assert.ok(uniform.bindGroup);
  });

  it("syncFromWasmCamera uploads a 16-float view at the camera's pointer", () => {
    const { device, uniform } = create();
    const memory = new WebAssembly.Memory({ initial: 1 });
    new Float32Array(memory.buffer, 256, 16).set(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    const camera = { view_proj_ptr: () => 256 } as Parameters<typeof uniform.syncFromWasmCamera>[0];

    uniform.syncFromWasmCamera(camera, () => memory);

    assert.equal(device.writes.length, 1);
    const [write] = device.writes;
    assert.equal(write!.buffer, device.buffers[0]);
    assert.equal(write!.offset, 0);
    assert.equal(write!.data.byteLength, 64);
    assert.equal(write!.data.buffer, memory.buffer);
    assert.equal(write!.data.byteOffset, 256);
    assert.deepEqual([...write!.data], Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("writeRawMatrix uploads the given 16 floats", () => {
    const { device, uniform } = create();
    const matrix = new Float32Array(16).fill(2);

    uniform.writeRawMatrix(matrix);

    assert.equal(device.writes[0]!.data, matrix);
    assert.equal(device.writes[0]!.offset, 0);
  });

  it("writeRawMatrix rejects matrices that are not 16 floats", () => {
    const { device, uniform } = create();

    assert.throws(() => uniform.writeRawMatrix(new Float32Array(9)), /16 floats/);
    assert.equal(device.writes.length, 0);
  });

  it("destroy() frees the uniform buffer", () => {
    const { device, uniform } = create();
    uniform.destroy();

    assert.equal(device.buffers[0]!.destroyed, true);
  });
});
