type WasmArray = Float32Array | Uint32Array;
type WasmArrayConstructor<T extends WasmArray> = new (
  buffer: ArrayBuffer,
  byteOffset: number,
  length: number,
) => T;

/**
 * A typed-array view over a fixed Wasm allocation (a pointer that never
 * moves), rebuilt automatically after Wasm memory growth detaches it.
 *
 * Read it through {@link WasmArrayView.get} at the point of use instead of
 * keeping the returned array across calls that may allocate.
 */
export class WasmArrayView<T extends WasmArray> {
  private view: T | null = null;

  private readonly type: WasmArrayConstructor<T>;
  private readonly pointer: number;
  private readonly length: number;
  private readonly wasmMemoryFn: () => WebAssembly.Memory;

  constructor(
    type: WasmArrayConstructor<T>,
    pointer: number,
    length: number,
    wasmMemoryFn: () => WebAssembly.Memory,
  ) {
    this.type = type;
    this.pointer = pointer;
    this.length = length;
    this.wasmMemoryFn = wasmMemoryFn;
  }

  /** The live view; a detached one (`byteLength` 0) is replaced first. */
  get(): T {
    if (this.view === null || this.view.buffer.byteLength === 0) {
      this.view = new this.type(this.wasmMemoryFn().buffer, this.pointer, this.length);
    }
    return this.view;
  }
}
