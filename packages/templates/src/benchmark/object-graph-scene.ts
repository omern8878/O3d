import { bufferUsage } from "../renderer/gpu-flags.ts";
import type { GeneratedPoint } from "./point-cloud-generator.ts";

/** A scene node the traditional way: one JS object per entity. */
export type ObjectGraphNode = {
  id: number;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number };
};

/** position + scale + color, three floats each. */
const FLOATS_PER_NODE = 9;

/**
 * The baseline O3d is compared against: an array-of-structs object graph that
 * has no change tracking, so every frame it walks all nodes, repacks them into
 * an interleaved `Float32Array` and uploads the whole buffer.
 */
export class ObjectGraphScene {
  readonly nodes: ObjectGraphNode[];

  private readonly device: GPUDevice;
  private readonly gpuBuffer: GPUBuffer;
  private readonly packed: Float32Array;

  constructor(device: GPUDevice, points: readonly GeneratedPoint[]) {
    this.device = device;
    this.nodes = points.map(({ position, scale, color }, id) => ({
      id,
      position: { x: position[0], y: position[1], z: position[2] },
      scale: { x: scale[0], y: scale[1], z: scale[2] },
      color: { r: color[0], g: color[1], b: color[2] },
    }));
    this.packed = new Float32Array(Math.max(points.length, 1) * FLOATS_PER_NODE);
    this.gpuBuffer = device.createBuffer({
      label: "baseline-interleaved-instances",
      size: this.packed.byteLength,
      usage: bufferUsage().VERTEX | bufferUsage().COPY_DST,
    });
  }

  /**
   * Repacks every node and uploads the whole buffer, as a renderer without
   * dirty tracking must. Returns the bytes uploaded.
   */
  packAndUpload(): number {
    const packed = this.packed;
    let offset = 0;
    for (const node of this.nodes) {
      packed[offset++] = node.position.x;
      packed[offset++] = node.position.y;
      packed[offset++] = node.position.z;
      packed[offset++] = node.scale.x;
      packed[offset++] = node.scale.y;
      packed[offset++] = node.scale.z;
      packed[offset++] = node.color.r;
      packed[offset++] = node.color.g;
      packed[offset++] = node.color.b;
    }
    const data = packed.subarray(0, offset);
    this.device.queue.writeBuffer(this.gpuBuffer, 0, data);
    return data.byteLength;
  }

  destroy(): void {
    this.gpuBuffer.destroy();
  }
}
