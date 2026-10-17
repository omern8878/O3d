/** Minimal in-memory stand-ins for WebGPU, for unit tests that run in Node. */

export type MockBuffer = {
  size: number;
  usage: number;
  destroyed: boolean;
  destroy(): void;
};

export type MockWrite = {
  buffer: MockBuffer;
  offset: number;
  data: Float32Array;
};

export type MockDevice = {
  buffers: MockBuffer[];
  writes: MockWrite[];
  createBuffer(descriptor: { size: number; usage: number }): MockBuffer;
  queue: {
    writeBuffer(buffer: MockBuffer, offset: number, data: Float32Array): void;
  };
};

/** Installs the `GPUBufferUsage` flags (real WebGPU values) as a global. */
export function installMockGpuGlobals(): void {
  Object.assign(globalThis, {
    GPUBufferUsage: { COPY_DST: 0x08, VERTEX: 0x20 },
  });
}

export function createMockDevice(): GPUDevice & MockDevice {
  const buffers: MockBuffer[] = [];
  const writes: MockWrite[] = [];

  const device: MockDevice = {
    buffers,
    writes,
    createBuffer({ size, usage }) {
      const buffer: MockBuffer = {
        size,
        usage,
        destroyed: false,
        destroy() {
          buffer.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data });
      },
    },
  };

  return device as unknown as GPUDevice & MockDevice;
}
