import type { ChannelType } from "../memory/dirty-tracker.ts";
import {
  BYTES_PER_FLOAT,
  BYTES_PER_VEC3,
  FLOATS_PER_VEC3,
} from "../memory/vec3-layout.ts";
import type { EntityManager } from "../scene/entity-manager.ts";
import type { VisibleViews } from "../types/culling.types.ts";

/** The slice of `EntityManager` this class reads from. */
type InstanceSource = Pick<
  EntityManager,
  "getActiveCount" | "getCapacity" | "getRawViews" | "getDirtyTracker"
>;

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
   * Uploads only the modified slices of each channel, straight from the Wasm
   * memory views, and returns the number of active instances (0 means nothing
   * drawn). Channels with no changes cause no `writeBuffer` call at all.
   */
  syncFromEntities(entityManager: InstanceSource): number {
    const dirtyTracker = entityManager.getDirtyTracker();
    const activeCount = entityManager.getActiveCount();
    if (activeCount === 0) {
      dirtyTracker.clear();
      return 0;
    }

    const reallocated = this.ensureGpuCapacity(entityManager.getCapacity());
    if (reallocated) {
      // Fresh GPU buffers are empty: everything must be uploaded again.
      dirtyTracker.markAllDirty(activeCount);
    }

    const views = entityManager.getRawViews();
    const targets: [ChannelType, GPUBuffer, Float32Array][] = [
      ["position", this.positionsBuffer, views.positions],
      ["scale", this.scalesBuffer, views.scales],
      ["color", this.colorsBuffer, views.colors],
    ];

    for (const [channel, gpuBuffer, view] of targets) {
      const range = dirtyTracker.getRange(channel, activeCount);
      if (range === null) {
        continue;
      }

      const floatOffset = range.min * FLOATS_PER_VEC3;
      const floatLength = (range.max - range.min + 1) * FLOATS_PER_VEC3;
      this.device.queue.writeBuffer(
        gpuBuffer,
        floatOffset * BYTES_PER_FLOAT,
        view.subarray(floatOffset, floatOffset + floatLength),
      );
    }

    dirtyTracker.clear();
    return activeCount;
  }

  /**
   * Uploads a frustum-culled, compacted instance set in full, replacing
   * whatever the buffers held. Returns the visible count (0 uploads nothing).
   *
   * The GPU buffers no longer mirror the dense entity arrays afterwards, so
   * the caller must mark entities dirty before switching back to
   * {@link GpuInstanceBuffers.syncFromEntities}.
   */
  syncFromVisibleViews(views: VisibleViews): number {
    const { visibleCount } = views;
    if (visibleCount === 0) {
      return 0;
    }

    this.ensureGpuCapacity(visibleCount);

    const floatLength = visibleCount * FLOATS_PER_VEC3;
    const { queue } = this.device;
    queue.writeBuffer(this.positionsBuffer, 0, views.positions.subarray(0, floatLength));
    queue.writeBuffer(this.scalesBuffer, 0, views.scales.subarray(0, floatLength));
    queue.writeBuffer(this.colorsBuffer, 0, views.colors.subarray(0, floatLength));

    return visibleCount;
  }

  /** Frees all three GPU buffers. */
  destroy(): void {
    this.destroyBuffers();
  }

  /**
   * Reallocates the buffers if `requiredCapacity` exceeds the current size.
   * Returns whether new (empty) buffers were created.
   */
  private ensureGpuCapacity(requiredCapacity: number): boolean {
    if (requiredCapacity <= this.gpuCapacity) {
      return false;
    }

    this.destroyBuffers();
    this.gpuCapacity = requiredCapacity;
    this.positionsBuffer = this.createBuffer("instance-positions");
    this.scalesBuffer = this.createBuffer("instance-scales");
    this.colorsBuffer = this.createBuffer("instance-colors");
    return true;
  }

  private createBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: this.gpuCapacity * BYTES_PER_VEC3,
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
