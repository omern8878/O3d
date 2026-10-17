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

/** One recorded call on a mock render pass. */
export type MockPassCall = { method: string; args: unknown[] };

export type MockRenderPass = {
  descriptor: GPURenderPassDescriptor;
  calls: MockPassCall[];
};

export type MockDevice = {
  buffers: MockBuffer[];
  writes: MockWrite[];
  shaderModules: GPUShaderModuleDescriptor[];
  pipelines: GPURenderPipelineDescriptor[];
  passes: MockRenderPass[];
  submitCount: number;
  createBuffer(descriptor: { size: number; usage: number }): MockBuffer;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): object;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): object;
  createCommandEncoder(): object;
  queue: {
    writeBuffer(buffer: MockBuffer, offset: number, data: Float32Array): void;
    submit(commandBuffers: unknown[]): void;
  };
};

/** Installs the `GPUBufferUsage` flags (real WebGPU values) as a global. */
export function installMockGpuGlobals(): void {
  Object.assign(globalThis, {
    GPUBufferUsage: { COPY_DST: 0x08, VERTEX: 0x20 },
  });
}

/** An object whose every method call is appended to `calls`. */
function recordingProxy(calls: MockPassCall[]): object {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => (...args: unknown[]) => {
        calls.push({ method, args });
      },
    },
  );
}

export function createMockDevice(): GPUDevice & MockDevice {
  const buffers: MockBuffer[] = [];
  const writes: MockWrite[] = [];
  const passes: MockRenderPass[] = [];

  const device: MockDevice = {
    buffers,
    writes,
    shaderModules: [],
    pipelines: [],
    passes,
    submitCount: 0,
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
    createShaderModule(descriptor) {
      device.shaderModules.push(descriptor);
      return { descriptor };
    },
    createRenderPipeline(descriptor) {
      device.pipelines.push(descriptor);
      return { descriptor };
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor: GPURenderPassDescriptor) {
          const pass: MockRenderPass = { descriptor, calls: [] };
          passes.push(pass);
          return recordingProxy(pass.calls);
        },
        finish: () => ({}),
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data });
      },
      submit() {
        device.submitCount += 1;
      },
    },
  };

  return device as unknown as GPUDevice & MockDevice;
}
