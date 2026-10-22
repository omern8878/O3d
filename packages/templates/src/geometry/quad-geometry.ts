import { bufferUsage } from "../renderer/gpu-flags.ts";

const FLOATS_PER_VERTEX = 2;

/**
 * Two triangles covering `[-0.5, -0.5]` to `[0.5, 0.5]`, as `x, y` pairs.
 * Counter-clockwise winding.
 */
const QUAD_VERTICES = new Float32Array([
  -0.5, -0.5,
  0.5, -0.5,
  0.5, 0.5,

  -0.5, -0.5,
  0.5, 0.5,
  -0.5, 0.5,
]);

/** A static unit quad, uploaded once to a GPU vertex buffer. */
export class QuadGeometry {
  readonly vertexBuffer: GPUBuffer;
  readonly vertexCount = QUAD_VERTICES.length / FLOATS_PER_VERTEX;

  constructor(device: GPUDevice) {
    this.vertexBuffer = device.createBuffer({
      label: "quad-vertices",
      size: QUAD_VERTICES.byteLength,
      usage: bufferUsage().VERTEX | bufferUsage().COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, QUAD_VERTICES);
  }

  /** Frees the GPU buffer. The geometry must not be used afterwards. */
  destroy(): void {
    this.vertexBuffer.destroy();
  }
}
