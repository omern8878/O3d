import { INSTANCED_QUAD_WGSL, type GpuContext } from '@engine/templates'

/** WebGPU flag values from the spec, for headless runs where the globals are missing. */
const BUFFER_USAGE = (globalThis as { GPUBufferUsage?: GPUBufferUsage }).GPUBufferUsage ??
  ({ VERTEX: 0x20, COPY_DST: 0x08, UNIFORM: 0x40 } as GPUBufferUsage)
const SHADER_STAGE = (globalThis as { GPUShaderStage?: GPUShaderStage }).GPUShaderStage ??
  ({ VERTEX: 0x1 } as GPUShaderStage)

/** position, scale, colour interleaved: 9 floats. */
export const FLOATS_PER_NODE = 9
const NODE_STRIDE = FLOATS_PER_NODE * 4
const QUAD = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5])
const MATRIX_BYTES = 64

/**
 * The baseline's renderer: one interleaved instance buffer re-uploaded in
 * full every frame and drawn with the same WGSL shader and blend state as
 * O3d's circle mode, so draw-side GPU work is identical per instance.
 */
export class JsAosRenderer {
  private readonly gpu: GpuContext
  private readonly pipeline: GPURenderPipeline
  private readonly quadBuffer: GPUBuffer
  private readonly uniformBuffer: GPUBuffer
  private readonly bindGroup: GPUBindGroup
  private instanceBuffer: GPUBuffer
  private capacity: number

  constructor(gpu: GpuContext, capacity: number) {
    this.gpu = gpu
    const { device } = gpu
    this.capacity = Math.max(capacity, 1)
    this.quadBuffer = device.createBuffer({ size: QUAD.byteLength, usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST })
    device.queue.writeBuffer(this.quadBuffer, 0, QUAD)
    this.instanceBuffer = this.createInstanceBuffer()
    this.uniformBuffer = device.createBuffer({ size: MATRIX_BYTES, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })

    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: SHADER_STAGE.VERTEX, buffer: { type: 'uniform' } }],
    })
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }] })
    const module = device.createShaderModule({ code: INSTANCED_QUAD_WGSL })
    const interleaved = (shaderLocation: number, offset: number): GPUVertexBufferLayout => ({
      arrayStride: NODE_STRIDE,
      stepMode: 'instance',
      attributes: [{ shaderLocation, offset, format: 'float32x3' }],
    })
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          interleaved(1, 0),
          interleaved(2, 12),
          interleaved(3, 24),
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        constants: { shape_mode: 1 },
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  /** Uploads the camera matrix (64 bytes). */
  writeCamera(viewProj: Float32Array): void {
    this.gpu.device.queue.writeBuffer(this.uniformBuffer, 0, viewProj)
  }

  /** Uploads `count` packed nodes in full and draws them. Returns the bytes uploaded. */
  draw(packed: Float32Array, count: number): number {
    const { device } = this.gpu
    if (count > this.capacity) {
      this.instanceBuffer.destroy()
      this.capacity = count * 2
      this.instanceBuffer = this.createInstanceBuffer()
    }
    const data = packed.subarray(0, count * FLOATS_PER_NODE)
    device.queue.writeBuffer(this.instanceBuffer, 0, data)

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.gpu.context.getCurrentTexture().createView(),
        clearValue: this.gpu.clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    if (count > 0) {
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bindGroup)
      pass.setVertexBuffer(0, this.quadBuffer)
      for (const slot of [1, 2, 3]) pass.setVertexBuffer(slot, this.instanceBuffer)
      pass.draw(6, count)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
    return data.byteLength
  }

  destroy(): void {
    this.quadBuffer.destroy()
    this.instanceBuffer.destroy()
    this.uniformBuffer.destroy()
  }

  private createInstanceBuffer(): GPUBuffer {
    return this.gpu.device.createBuffer({
      size: this.capacity * NODE_STRIDE,
      usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST,
    })
  }
}
