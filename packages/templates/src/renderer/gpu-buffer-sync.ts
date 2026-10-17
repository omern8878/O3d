import type { EntityManager } from "../scene/entity-manager.ts";

/** The slice of `EntityManager` this class reads from. */
type InstanceSource = Pick<
  EntityManager,
  "getActiveCount" | "getCapacity" | "getRawViews"
>;

const FLOATS_PER_VEC3 = 3;
const BYTES_PER_FLOAT = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_VEC3 * BYTES_PER_FLOAT;

/**
 * Per-instance `positions`, `scales` and `colors` vertex buffers in VRAM, kept
 * in sync with the Wasm entity data.
 *
 * The three buffers are replaced when the GPU capacity grows, so read them
 * through this object each frame instead of caching them.
 */
export class GpuInstanceBuffers {
  positionsBuffer: GPUBuffer;
  scalesBuffer: GPUBuffer;
  colorsBuffer: GPUBuffer;
  gpuCapacity: number;

  private readonly device: GPUDevice;

  constructor(device: GPUDevice, initialCapacity: number) {
    this.device = device;
    this.gpuCapacity = Math.max(initialCapacity, 1);
    this.positionsBuffer = this.createBuffer("instance-positions");
    this.scalesBuffer = this.createBuffer("instance-scales");
    this.colorsBuffer = this.createBuffer("instance-colors");
  }

  /**
   * Uploads the active entities straight from Wasm memory views to the GPU
   * queue, and returns the number of active instances (0 means nothing drawn).
   */
  syncFromEntities(entityManager: InstanceSource): number {
    const activeCount = entityManager.getActiveCount();
    if (activeCount === 0) {
      return 0;
    }

    this.ensureGpuCapacity(entityManager.getCapacity());

    const { positions, scales, colors } = entityManager.getRawViews();
    this.device.queue.writeBuffer(this.positionsBuffer, 0, positions);
    this.device.queue.writeBuffer(this.scalesBuffer, 0, scales);
    this.device.queue.writeBuffer(this.colorsBuffer, 0, colors);

    return activeCount;
  }

  /** Frees all three GPU buffers. */
  destroy(): void {
    this.destroyBuffers();
  }

  /** Reallocates the buffers if `requiredCapacity` exceeds the current size. */
  private ensureGpuCapacity(requiredCapacity: number): void {
    if (requiredCapacity <= this.gpuCapacity) {
      return;
    }

    this.destroyBuffers();
    this.gpuCapacity = requiredCapacity;
    this.positionsBuffer = this.createBuffer("instance-positions");
    this.scalesBuffer = this.createBuffer("instance-scales");
    this.colorsBuffer = this.createBuffer("instance-colors");
  }

  private createBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: this.gpuCapacity * BYTES_PER_INSTANCE,
      // Read lazily: `GPUBufferUsage` does not exist where WebGPU is unsupported.
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  private destroyBuffers(): void {
    this.positionsBuffer.destroy();
    this.scalesBuffer.destroy();
    this.colorsBuffer.destroy();
  }
}
