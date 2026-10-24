import { LineBuffer, wasm_memory } from "@engine/core/pkg/engine.js";
import { DirtyTracker } from "../memory/dirty-tracker.ts";
import { WasmArrayView } from "../memory/wasm-array-view.ts";
import { bufferUsage } from "../renderer/gpu-flags.ts";
import type { LineChannel } from "../types/batch.types.ts";

export const FLOATS_PER_LINE_SEGMENT = 6;
export const COLORS_PER_LINE_SEGMENT = 2;
const BYTES_PER_ELEMENT = 4;

const LINE_CHANNELS: readonly LineChannel[] = ["vertex", "color"];

/** Elements per segment in each channel. */
const CHANNEL_STRIDE: Record<LineChannel, number> = {
  vertex: FLOATS_PER_LINE_SEGMENT,
  color: COLORS_PER_LINE_SEGMENT,
};

export type LineBatchOptions = {
  wasmMemoryFn?: () => WebAssembly.Memory;
};

/**
 * Up to `capacity` 3D line segments, drawn as one `line-list` draw call by
 * the {@link BatchRenderer}. WebGPU lines are always 1 device pixel wide.
 *
 * Segment data lives in Wasm memory and is exposed as zero-copy views:
 *
 * - vertices: `[x1, y1, z1, x2, y2, z2]` per segment (`Float32Array`)
 * - colors: packed RGBA `[start, end]` per segment (`Uint32Array`)
 *
 * As with {@link InstancedMesh}: write into the views, report the touched
 * segments with {@link LineBatch.markDirty}, and only that range is uploaded
 * on the next frame. Fetch the views again rather than keeping them, since
 * Wasm memory growth detaches them.
 */
export class LineBatch {
  readonly capacity: number;
  readonly verticesBuffer: GPUBuffer;
  readonly colorsBuffer: GPUBuffer;

  private readonly device: GPUDevice;
  private readonly lines: LineBuffer;
  private readonly dirtyTracker = new DirtyTracker(LINE_CHANNELS);
  private readonly vertices: WasmArrayView<Float32Array>;
  private readonly colors: WasmArrayView<Uint32Array>;

  constructor(device: GPUDevice, capacity: number, options: LineBatchOptions = {}) {
    const wasmMemoryFn =
      options.wasmMemoryFn ?? (() => wasm_memory() as WebAssembly.Memory);
    this.device = device;
    this.lines = new LineBuffer(capacity);
    this.capacity = this.lines.capacity();

    this.vertices = new WasmArrayView(
      Float32Array,
      this.lines.vertices_ptr(),
      this.capacity * FLOATS_PER_LINE_SEGMENT,
      wasmMemoryFn,
    );
    this.colors = new WasmArrayView(
      Uint32Array,
      this.lines.colors_ptr(),
      this.capacity * COLORS_PER_LINE_SEGMENT,
      wasmMemoryFn,
    );

    this.verticesBuffer = this.createBuffer("vertex");
    this.colorsBuffer = this.createBuffer("color");
  }

  /** Number of leading segments drawn. */
  getCount(): number {
    return this.lines.count();
  }

  /**
   * Sets how many leading segments are drawn (clamped to the capacity) and
   * returns the value applied. Segments that become active are uploaded on
   * the next frame; data past the count is kept.
   */
  setCount(count: number): number {
    const previous = this.lines.count();
    const applied = this.lines.set_count(Math.max(0, Math.floor(count)));
    if (applied > previous) {
      this.markDirty(previous, applied - 1);
    }
    return applied;
  }

  /** Zero-copy `[x1, y1, z1, x2, y2, z2]` view over all `capacity` segments. */
  getVertices(): Float32Array {
    return this.vertices.get();
  }

  /** Zero-copy packed-RGBA `[start, end]` view over all `capacity` segments. */
  getColors(): Uint32Array {
    return this.colors.get();
  }

  /**
   * Schedules segments `first ..= last` for upload on `channels` (both by
   * default) after writing into the views directly.
   */
  markDirty(
    first: number,
    last: number = first,
    channels: readonly LineChannel[] = LINE_CHANNELS,
  ): void {
    for (const channel of channels) {
      this.dirtyTracker.markRangeDirty(channel, first, last);
    }
  }

  /** Marks every active segment dirty on both channels. */
  markAllDirty(): void {
    this.dirtyTracker.markAllDirty(this.lines.count());
  }

  /** Writes one segment's endpoints and marks it dirty. */
  setSegment(
    index: number,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): void {
    const offset = index * FLOATS_PER_LINE_SEGMENT;
    const vertices = this.vertices.get();
    vertices[offset] = x1;
    vertices[offset + 1] = y1;
    vertices[offset + 2] = z1;
    vertices[offset + 3] = x2;
    vertices[offset + 4] = y2;
    vertices[offset + 5] = z2;
    this.dirtyTracker.markDirty("vertex", index);
  }

  /** Writes one segment's packed RGBA endpoint colors and marks it dirty. */
  setSegmentColors(index: number, startRgba: number, endRgba: number = startRgba): void {
    const offset = index * COLORS_PER_LINE_SEGMENT;
    const colors = this.colors.get();
    colors[offset] = startRgba;
    colors[offset + 1] = endRgba;
    this.dirtyTracker.markDirty("color", index);
  }

  /**
   * Uploads each channel's dirty range (clipped to the active count) straight
   * from Wasm memory, then marks everything clean. Returns the number of
   * segments to draw.
   */
  sync(): number {
    const count = this.lines.count();
    const sources: [LineChannel, GPUBuffer, Float32Array | Uint32Array][] = [
      ["vertex", this.verticesBuffer, this.vertices.get()],
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

  /** Frees the GPU buffers and the Wasm storage. */
  destroy(): void {
    this.verticesBuffer.destroy();
    this.colorsBuffer.destroy();
    this.lines.free();
  }

  private createBuffer(channel: LineChannel): GPUBuffer {
    return this.device.createBuffer({
      label: `line-${channel}s`,
      size: this.capacity * CHANNEL_STRIDE[channel] * BYTES_PER_ELEMENT,
      usage: bufferUsage().VERTEX | bufferUsage().COPY_DST,
    });
  }
}
