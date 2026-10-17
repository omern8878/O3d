import { QuadGeometry } from "../geometry/quad-geometry.ts";
import type { EntityManager } from "../scene/entity-manager.ts";
import { GpuInstanceBuffers } from "./gpu-buffer-sync.ts";
import type { GpuContext } from "./gpu-context.ts";
import { INSTANCED_QUAD_WGSL } from "./shaders/instanced-quad.wgsl.ts";

const VEC2_STRIDE = 2 * 4;
const VEC3_STRIDE = 3 * 4;

/** One tightly packed vertex buffer holding a single attribute. */
function attributeLayout(
  shaderLocation: number,
  format: GPUVertexFormat,
  arrayStride: number,
  stepMode: GPUVertexStepMode,
): GPUVertexBufferLayout {
  return {
    arrayStride,
    stepMode,
    attributes: [{ shaderLocation, offset: 0, format }],
  };
}

/**
 * Draws every entity as an instanced, colored quad in a single draw call.
 *
 * Vertex buffer slots: 0 = quad corners (per vertex), 1 = positions,
 * 2 = scales, 3 = colors (per instance).
 */
export class InstancedRenderer {
  private readonly gpuContext: GpuContext;
  private readonly quadGeometry: QuadGeometry;
  private readonly instanceBuffers: GpuInstanceBuffers;
  private readonly pipeline: GPURenderPipeline;

  constructor(gpuContext: GpuContext, initialCapacity: number = 1000) {
    this.gpuContext = gpuContext;
    const { device } = gpuContext;

    this.quadGeometry = new QuadGeometry(device);
    this.instanceBuffers = new GpuInstanceBuffers(device, initialCapacity);

    const module = device.createShaderModule({
      label: "instanced-quad-shader",
      code: INSTANCED_QUAD_WGSL,
    });
    this.pipeline = device.createRenderPipeline({
      label: "instanced-quad-pipeline",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          attributeLayout(0, "float32x2", VEC2_STRIDE, "vertex"),
          attributeLayout(1, "float32x3", VEC3_STRIDE, "instance"),
          attributeLayout(2, "float32x3", VEC3_STRIDE, "instance"),
          attributeLayout(3, "float32x3", VEC3_STRIDE, "instance"),
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: gpuContext.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });
  }

  /**
   * Uploads the current entity data and draws one frame.
   * Returns the number of instances drawn.
   */
  render(entityManager: EntityManager): number {
    const instanceCount = this.instanceBuffers.syncFromEntities(entityManager);

    const { device } = this.gpuContext;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpuContext.context.getCurrentTexture().createView(),
          clearValue: this.gpuContext.clearColor,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    if (instanceCount > 0) {
      pass.setPipeline(this.pipeline);
      pass.setVertexBuffer(0, this.quadGeometry.vertexBuffer);
      pass.setVertexBuffer(1, this.instanceBuffers.positionsBuffer);
      pass.setVertexBuffer(2, this.instanceBuffers.scalesBuffer);
      pass.setVertexBuffer(3, this.instanceBuffers.colorsBuffer);
      pass.draw(this.quadGeometry.vertexCount, instanceCount, 0, 0);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);

    return instanceCount;
  }

  /** Frees the GPU buffers owned by this renderer. */
  destroy(): void {
    this.quadGeometry.destroy();
    this.instanceBuffers.destroy();
  }
}
