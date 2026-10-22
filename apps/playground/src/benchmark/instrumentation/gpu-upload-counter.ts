type WriteBuffer = GPUQueue['writeBuffer']

/**
 * Counts every byte any engine writes through `GPUQueue.writeBuffer` by
 * wrapping the prototype method once. Engines are measured by what reaches
 * the driver, not by what they claim, and uniforms count too.
 *
 * Unavailable (always `null`) where WebGPU does not exist.
 */
export class GpuUploadCounter {
  private bytes = 0
  private readonly installed: boolean

  constructor() {
    const queueClass = (globalThis as { GPUQueue?: { prototype: GPUQueue } }).GPUQueue
    this.installed = queueClass !== undefined
    if (!queueClass) return
    const proto = queueClass.prototype as GPUQueue & { __o3dCounter?: GpuUploadCounter }
    const marker = proto as unknown as { __o3dOriginalWrite?: WriteBuffer; __o3dActive?: GpuUploadCounter }
    marker.__o3dActive = this
    if (marker.__o3dOriginalWrite) return
    const original = proto.writeBuffer
    marker.__o3dOriginalWrite = original
    proto.writeBuffer = function (this: GPUQueue, ...args: Parameters<WriteBuffer>) {
      marker.__o3dActive?.add(byteLengthOf(args))
      return original.apply(this, args)
    } as WriteBuffer
  }

  /** Starts a fresh count. */
  reset(): void {
    this.bytes = 0
  }

  /** Bytes written since the last reset, or `null` without WebGPU. */
  read(): number | null {
    return this.installed ? this.bytes : null
  }

  private add(bytes: number): void {
    this.bytes += bytes
  }
}

/** `writeBuffer(buffer, offset, data, dataOffset?, size?)`: offsets/sizes are elements for typed arrays. */
function byteLengthOf([, , data, dataOffset = 0, size]: Parameters<WriteBuffer>): number {
  const elementSize = ArrayBuffer.isView(data) ? (data as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1 : 1
  if (size !== undefined) return size * elementSize
  return (data as ArrayBufferLike | ArrayBufferView).byteLength - dataOffset * elementSize
}
