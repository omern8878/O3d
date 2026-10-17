import type { Camera } from "@engine/core/pkg/engine.js";
import { BYTES_PER_FLOAT } from "../memory/vec3-layout.ts";

const MATRIX_FLOATS = 16;
const MATRIX_BYTES = MATRIX_FLOATS * BYTES_PER_FLOAT;

/**
 * A 64-byte uniform buffer holding the camera's column-major `view_proj`
 * matrix, plus the bind group that exposes it at `@binding(0)`.
 */
export class CameraUniformBuffer {
  readonly bindGroup: GPUBindGroup;

  private readonly device: GPUDevice;
  private readonly uniformBuffer: GPUBuffer;

  constructor(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout) {
    this.device = device;
    this.uniformBuffer = device.createBuffer({
      label: "camera-view-proj",
      size: MATRIX_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      label: "camera-bind-group",
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  /**
   * Uploads the camera's matrix straight from Wasm linear memory.
   * Call it again after every camera change.
   */
  syncFromWasmCamera(
    wasmCamera: Camera,
    wasmMemoryFn: () => WebAssembly.Memory,
  ): void {
    const view = new Float32Array(
      wasmMemoryFn().buffer,
      wasmCamera.view_proj_ptr(),
      MATRIX_FLOATS,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, view);
  }

  /**
   * Uploads a column-major matrix from JS memory (e.g. the identity default).
   *
   * @throws {Error} if `matrix16` does not hold exactly 16 floats.
   */
  writeRawMatrix(matrix16: Float32Array): void {
    if (matrix16.length !== MATRIX_FLOATS) {
      throw new Error(
        `Camera matrix must have ${MATRIX_FLOATS} floats, got ${matrix16.length}.`,
      );
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, matrix16);
  }

  /** Frees the GPU buffer. */
  destroy(): void {
    this.uniformBuffer.destroy();
  }
}
