import { wasm_memory, type Camera } from "@engine/core/pkg/engine.js";
import type { InstancedMesh } from "../batch/instanced-mesh.ts";
import type { LineBatch } from "../batch/line-batch.ts";
import { COLORS_PER_LINE_SEGMENT } from "../batch/line-batch.ts";
import type { CameraController } from "../scene/camera-controller.ts";
import type { BatchFrameStats, MeshShading } from "../types/batch.types.ts";
import {
  BATCH_DEPTH_FORMAT,
  createInstancedMeshPipeline,
  createLineBatchPipeline,
  type BatchPipelineOptions,
} from "./batch-pipelines.ts";
import { CameraUniformBuffer } from "./camera-uniform-buffer.ts";
import { shaderStage, textureUsage } from "./gpu-flags.ts";
import type { GpuContext } from "./gpu-context.ts";
import { INSTANCED_MESH_WGSL, LINE_BATCH_WGSL } from "./shaders/batch.wgsl.ts";

/** What a frame draws: line batches first, then instanced meshes. */
export type BatchScene = {
  readonly lines?: readonly LineBatch[];
  readonly meshes?: readonly InstancedMesh[];
};

/**
 * Draws {@link InstancedMesh} and {@link LineBatch} batches in one
 * depth-tested render pass: one draw call per non-empty batch, whatever its
 * size. Each frame uploads only the batches' dirty ranges, plus the 64-byte
 * camera matrix when the camera changed.
 *
 * It owns its camera uniform. The camera's dirty flag is shared by every
 * renderer synced from the same {@link CameraController}, so give each
 * renderer its own controller.
 */
export class BatchRenderer {
  private readonly gpuContext: GpuContext;
  private readonly cameraUniform: CameraUniformBuffer;
  private readonly pipelineOptions: { mesh: BatchPipelineOptions; line: BatchPipelineOptions };
  private readonly meshPipelines = new Map<MeshShading, GPURenderPipeline>();
  private linePipeline: GPURenderPipeline | null = null;
  private depthTexture: GPUTexture | null = null;

  constructor(gpuContext: GpuContext) {
    this.gpuContext = gpuContext;
    const { device } = gpuContext;

    const cameraLayout = device.createBindGroupLayout({
      label: "batch-camera-bind-group-layout",
      entries: [{ binding: 0, visibility: shaderStage().VERTEX, buffer: { type: "uniform" } }],
    });
    this.cameraUniform = new CameraUniformBuffer(device, cameraLayout);
    const pipelineLayout = device.createPipelineLayout({
      label: "batch-pipeline-layout",
      bindGroupLayouts: [cameraLayout],
    });
    const options = (label: string, code: string): BatchPipelineOptions => ({
      device,
      shaderModule: device.createShaderModule({ label, code }),
      pipelineLayout,
      colorFormat: gpuContext.format,
    });
    this.pipelineOptions = {
      mesh: options("instanced-mesh-shader", INSTANCED_MESH_WGSL),
      line: options("line-batch-shader", LINE_BATCH_WGSL),
    };
  }

  /**
   * Uploads the camera's `view_proj`; called by
   * {@link CameraController.syncIfDirty}.
   */
  updateCamera(
    wasmCamera: Camera,
    wasmMemoryFn: () => WebAssembly.Memory = () => wasm_memory() as WebAssembly.Memory,
  ): void {
    this.cameraUniform.syncFromWasmCamera(wasmCamera, wasmMemoryFn);
  }

  /** Syncs the camera and every batch, then clears and draws one frame. */
  render(camera: CameraController, scene: BatchScene): BatchFrameStats {
    camera.syncIfDirty(this);
    const stats: BatchFrameStats = { drawCalls: 0, instances: 0, segments: 0 };

    const { device, context, clearColor } = this.gpuContext;
    const target = context.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), clearValue: clearColor, loadOp: "clear", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: this.depthViewFor(target),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    pass.setBindGroup(0, this.cameraUniform.bindGroup);

    for (const lines of scene.lines ?? []) {
      const segments = lines.sync();
      if (segments === 0) continue;
      pass.setPipeline(this.linePipelineOnce());
      pass.setVertexBuffer(0, lines.verticesBuffer);
      pass.setVertexBuffer(1, lines.colorsBuffer);
      pass.draw(segments * COLORS_PER_LINE_SEGMENT);
      stats.drawCalls += 1;
      stats.segments += segments;
    }

    for (const batch of scene.meshes ?? []) {
      const instances = batch.sync();
      if (instances === 0 || batch.mesh.indexCount === 0) continue;
      pass.setPipeline(this.meshPipelineFor(batch.shading));
      pass.setVertexBuffer(0, batch.mesh.vertexBuffer);
      pass.setVertexBuffer(1, batch.transformsBuffer);
      pass.setVertexBuffer(2, batch.rotationsBuffer);
      pass.setVertexBuffer(3, batch.colorsBuffer);
      pass.setIndexBuffer(batch.mesh.indexBuffer, "uint32");
      pass.drawIndexed(batch.mesh.indexCount, instances);
      stats.drawCalls += 1;
      stats.instances += instances;
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
    return stats;
  }

  /** Frees the camera uniform and the depth texture (batches are not owned). */
  destroy(): void {
    this.cameraUniform.destroy();
    this.depthTexture?.destroy();
    this.depthTexture = null;
  }

  /** A depth view matching the target's size; reallocated only on resize. */
  private depthViewFor(target: GPUTexture): GPUTextureView {
    const { width, height } = target;
    if (this.depthTexture?.width !== width || this.depthTexture.height !== height) {
      this.depthTexture?.destroy();
      this.depthTexture = this.gpuContext.device.createTexture({
        label: "batch-depth",
        size: { width, height },
        format: BATCH_DEPTH_FORMAT,
        usage: textureUsage().RENDER_ATTACHMENT,
      });
    }
    return this.depthTexture.createView();
  }

  private meshPipelineFor(shading: MeshShading): GPURenderPipeline {
    let pipeline = this.meshPipelines.get(shading);
    if (!pipeline) {
      pipeline = createInstancedMeshPipeline({ ...this.pipelineOptions.mesh, shading });
      this.meshPipelines.set(shading, pipeline);
    }
    return pipeline;
  }

  private linePipelineOnce(): GPURenderPipeline {
    this.linePipeline ??= createLineBatchPipeline(this.pipelineOptions.line);
    return this.linePipeline;
  }
}
