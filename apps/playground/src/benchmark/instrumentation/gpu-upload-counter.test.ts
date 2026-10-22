import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { GpuUploadCounter } from './gpu-upload-counter.ts'

describe('GpuUploadCounter', () => {
  const globals = globalThis as { GPUQueue?: unknown }
  after(() => delete globals.GPUQueue)

  it('is unavailable without WebGPU', () => {
    delete globals.GPUQueue
    assert.equal(new GpuUploadCounter().read(), null)
  })

  it('counts bytes for every writeBuffer form and still forwards the call', () => {
    const forwarded: number[] = []
    class FakeQueue {
      writeBuffer(_buffer: unknown, offset: number) {
        forwarded.push(offset)
      }
    }
    globals.GPUQueue = FakeQueue
    const counter = new GpuUploadCounter()
    const queue = new FakeQueue() as unknown as GPUQueue
    const buffer = {} as GPUBuffer

    queue.writeBuffer(buffer, 0, new Float32Array(16))         // whole typed array: 64 B
    queue.writeBuffer(buffer, 8, new Float32Array(100), 10, 5) // 5 floats: 20 B
    queue.writeBuffer(buffer, 4, new ArrayBuffer(40), 8)       // bytes after offset: 32 B
    assert.equal(counter.read(), 116)
    assert.deepEqual(forwarded, [0, 8, 4])

    counter.reset()
    assert.equal(counter.read(), 0)
  })
})
