import { InstanceBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import type { GpuMesh } from "../geometry/gpu-mesh.ts";
import { DirtyTracker } from "../memory/dirty-tracker.ts";
import { WasmArrayView } from "../memory/wasm-array-view.ts";
import { bufferUsage } from "../renderer/gpu-flags.ts";
import type { CameraController } from "../scene/camera-controller.ts";
import type { InstanceChannel, MeshShading } from "../types/batch.types.ts";

export const FLOATS_PER_INSTANCE_TRANSFORM = 4;
export const FLOATS_PER_INSTANCE_ROTATION = 4;
const BYTES_PER_ELEMENT = 4;

const INSTANCE_CHANNELS: readonly InstanceChannel[] = ["transform", "rotation", "color"];

/** Elements per instance in each channel. */
const CHANNEL_STRIDE: Record<InstanceChannel, number> = {
  transform: FLOATS_PER_INSTANCE_TRANSFORM,
  rotation: FLOATS_PER_INSTANCE_ROTATION,
  color: 1,
};

export type InstancedMeshOptions = {
  /** `'lit'` (default) shades by a fixed light; `'flat'` draws the exact color. */
  shading?: MeshShading;
  wasmMemoryFn?: () => WebAssembly.Memory;
};

/**
 * Up to `capacity` instances of one {@link GpuMesh}, drawn in a single
 * instanced, indexed draw call by the {@link BatchRenderer}.
 *
 * Per-instance data lives in Wasm memory and is exposed as zero-copy views:
 *
 * - transforms: `[x, y, z, uniformScale]` per instance (`Float32Array`)
 * - rotations: unit quaternion `[x, y, z, w]` per instance (`Float32Array`)
 * - colors: packed RGBA per instance (`Uint32Array`, see `packRgba`)
 *
 * Write into the views directly and report the touched range with
 * {@link InstancedMesh.markDirty}; the next frame uploads only that range,
 * straight from Wasm memory. The setters do both for single instances. The
 * capacity is fixed, so the views never move, but they detach when Wasm
 * memory grows: fetch them again through the getters rather than keeping them.
 */
export class InstancedMesh {
  readonly mesh: GpuMesh;
  readonly capacity: number;
  readonly shading: MeshShading;
  readonly transformsBuffer: GPUBuffer;
  readonly rotationsBuffer: GPUBuffer;
  readonly colorsBuffer: GPUBuffer;

  private readonly device: GPUDevice;
  private readonly instances: InstanceBuffer;
  private readonly dirtyTracker = new DirtyTracker(INSTANCE_CHANNELS);
  private readonly transforms: WasmArrayView<Float32Array>;
  private readonly rotations: WasmArrayView<Float32Array>;
  private readonly colors: WasmArrayView<Uint32Array>;

  constructor(
    device: GPUDevice,
    mesh: GpuMesh,
    capacity: number,
    options: InstancedMeshOptions = {},
  ) {
    const wasmMemoryFn =
      options.wasmMemoryFn ?? (() => wasm_memory() as WebAssembly.Memory);
    this.device = device;
    this.mesh = mesh;
    this.shading = options.shading ?? "lit";
    this.instances = new InstanceBuffer(capacity);
    this.capacity = this.instances.capacity();

    this.transforms = new WasmArrayView(
      Float32Array,
      this.instances.transforms_ptr(),
      this.capacity * FLOATS_PER_INSTANCE_TRANSFORM,
      wasmMemoryFn,
    );
    this.rotations = new WasmArrayView(
      Float32Array,
      this.instances.rotations_ptr(),
      this.capacity * FLOATS_PER_INSTANCE_ROTATION,
      wasmMemoryFn,
    );
    this.colors = new WasmArrayView(
      Uint32Array,
      this.instances.colors_ptr(),
      this.capacity,
      wasmMemoryFn,
    );

    this.transformsBuffer = this.createBuffer("transform");
    this.rotationsBuffer = this.createBuffer("rotation");
    this.colorsBuffer = this.createBuffer("color");
  }

  /** Number of leading instances drawn. */
  getCount(): number {
    return this.instances.count();
  }

  /**
   * Sets how many leading instances are drawn (clamped to the capacity) and
   * returns the value applied. Instances that become active are uploaded on
   * the next frame; data past the count is kept.
   */
  setCount(count: number): number {
    const previous = this.instances.count();
    const applied = this.instances.set_count(Math.max(0, Math.floor(count)));
    if (applied > previous) {
      this.markDirty(previous, applied - 1);
    }
    return applied;
  }

  /** Zero-copy `[x, y, z, scale]` view over all `capacity` instances. */
  getTransforms(): Float32Array {
    return this.transforms.get();
  }

  /** Zero-copy quaternion `[x, y, z, w]` view over all `capacity` instances. */
  getRotations(): Float32Array {
    return this.rotations.get();
  }

  /** Zero-copy packed-RGBA view over all `capacity` instances. */
  getColors(): Uint32Array {
    return this.colors.get();
  }

  /**
   * Schedules instances `first ..= last` for upload on `channels` (all three
   * by default) after writing into the views directly.
   */
  markDirty(
    first: number,
    last: number = first,
    channels: readonly InstanceChannel[] = INSTANCE_CHANNELS,
  ): void {
    for (const channel of channels) {
      this.dirtyTracker.markRangeDirty(channel, first, last);
    }
  }

  /** Marks every active instance dirty on every channel. */
  markAllDirty(): void {
    this.dirtyTracker.markAllDirty(this.instances.count());
  }

  /** Writes one instance's position and uniform scale, and marks it dirty. */
  setTransform(index: number, x: number, y: number, z: number, scale: number): void {
    const offset = index * FLOATS_PER_INSTANCE_TRANSFORM;
    const transforms = this.transforms.get();
    transforms[offset] = x;
    transforms[offset + 1] = y;
    transforms[offset + 2] = z;
    transforms[offset + 3] = scale;
    this.dirtyTracker.markDirty("transform", index);
  }

  /** Writes one instance's position, keeping its scale, and marks it dirty. */
  setPosition(index: number, x: number, y: number, z: number): void {
    const offset = index * FLOATS_PER_INSTANCE_TRANSFORM;
    const transforms = this.transforms.get();
    transforms[offset] = x;
    transforms[offset + 1] = y;
    transforms[offset + 2] = z;
    this.dirtyTracker.markDirty("transform", index);
  }

  /** Writes one instance's unit-quaternion rotation and marks it dirty. */
  setRotation(index: number, x: number, y: number, z: number, w: number): void {
    const offset = index * FLOATS_PER_INSTANCE_ROTATION;
    const rotations = this.rotations.get();
    rotations[offset] = x;
    rotations[offset + 1] = y;
    rotations[offset + 2] = z;
    rotations[offset + 3] = w;
    this.dirtyTracker.markDirty("rotation", index);
  }

  /** Writes one instance's packed RGBA color and marks it dirty. */
  setColor(index: number, rgba: number): void {
    this.colors.get()[index] = rgba;
    this.dirtyTracker.markDirty("color", index);
  }

  /**
   * Index of the active instance nearest to the camera under the screen point
   * `(ndcX, ndcY)`, or `-1`. Each instance is the mesh's bounding sphere,
   * scaled by the instance; the transforms are read in place, in Wasm.
   */
  raycastNdc(camera: CameraController, ndcX: number, ndcY: number): number {
    return this.instances.raycast_ndc(
      camera.getRawWasmCamera(),
      ndcX,
      ndcY,
      this.mesh.boundingRadius,
    );
  }

  /** Ascending indices of the active instances inside the camera frustum. */
  visibleIndices(camera: CameraController): Uint32Array {
    return this.instances.visible_indices(camera.getRawWasmCamera(), this.mesh.boundingRadius);
  }

  /**
   * Uploads each channel's dirty range (clipped to the active count) straight
   * from Wasm memory, then marks everything clean. Clean channels cost no
   * `writeBuffer` call. Returns the number of instances to draw.
   */
  sync(): number {
    const count = this.instances.count();
    const sources: [InstanceChannel, GPUBuffer, Float32Array | Uint32Array][] = [
      ["transform", this.transformsBuffer, this.transforms.get()],
      ["rotation", this.rotationsBuffer, this.rotations.get()],
      ["color", this.colorsBuffer, this.colors.get()],
    ];
    for (const [channel, gpuBuffer, view] of sources) {
      const range = this.dirtyTracker.getRange(channel, count);
      if (range === null) {
        continue;
      }
      const stride = CHANNEL_STRIDE[channel];
      const start = range.min * stride;
      const end = (range.max + 1) * stride;
      this.device.queue.writeBuffer(
        gpuBuffer,
        start * BYTES_PER_ELEMENT,
        view.subarray(start, end),
      );
    }
    this.dirtyTracker.clear();
    return count;
  }

  /**
   * Frees the GPU buffers and the Wasm storage. The shared {@link GpuMesh} is
   * left alone, since other batches may use it.
   */
  destroy(): void {
    this.transformsBuffer.destroy();
    this.rotationsBuffer.destroy();
    this.colorsBuffer.destroy();
    this.instances.free();
  }

  private createBuffer(channel: InstanceChannel): GPUBuffer {
    return this.device.createBuffer({
      label: `instance-${channel}s`,
      size: this.capacity * CHANNEL_STRIDE[channel] * BYTES_PER_ELEMENT,
      usage: bufferUsage().VERTEX | bufferUsage().COPY_DST,
    });
  }
}
