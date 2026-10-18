import { wasm_memory, type Camera } from "@engine/core/pkg/engine.js";
import { QuadGeometry } from "../geometry/quad-geometry.ts";
import { BYTES_PER_FLOAT, BYTES_PER_VEC3 } from "../memory/vec3-layout.ts";
import type { CameraController } from "../scene/camera-controller.ts";
import type { CullingManager } from "../scene/culling-manager.ts";
import type { EntityManager } from "../scene/entity-manager.ts";
import { CameraUniformBuffer } from "./camera-uniform-buffer.ts";
import { GpuInstanceBuffers } from "./gpu-buffer-sync.ts";
import type { GpuContext } from "./gpu-context.ts";
import { INSTANCED_QUAD_WGSL } from "./shaders/instanced-quad.wgsl.ts";

const VEC2_STRIDE = 2 * BYTES_PER_FLOAT;
const VEC3_STRIDE = BYTES_PER_VEC3;
const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

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
 * Bind group 0 holds the camera `view_proj` uniform (identity until
 * {@link InstancedRenderer.updateCamera} is called). Vertex buffer slots: 0 = quad corners (per vertex), 1 = positions,
 * 2 = scales, 3 = colors (per instance).
 */
export class InstancedRenderer {
  private readonly gpuContext: GpuContext;
  private readonly quadGeometry: QuadGeometry;
  private readonly instanceBuffers: GpuInstanceBuffers;
  private readonly cameraUniform: CameraUniformBuffer;
  private readonly pipeline: GPURenderPipeline;
  /** Whether the instance buffers currently hold a culled subset, not the dense arrays. */
  private holdsCulledSubset = false;

  constructor(gpuContext: GpuContext, initialCapacity: number = 1000) {
    this.gpuContext = gpuContext;
    const { device } = gpuContext;

    this.quadGeometry = new QuadGeometry(device);
    this.instanceBuffers = new GpuInstanceBuffers(device, initialCapacity);

    const cameraLayout = device.createBindGroupLayout({
      label: "camera-bind-group-layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.cameraUniform = new CameraUniformBuffer(device, cameraLayout);
    this.cameraUniform.writeRawMatrix(IDENTITY_MATRIX);

    const module = device.createShaderModule({
      label: "instanced-quad-shader",
      code: INSTANCED_QUAD_WGSL,
    });
    this.pipeline = device.createRenderPipeline({
      label: "instanced-quad-pipeline",
      layout: device.createPipelineLayout({
        label: "instanced-quad-pipeline-layout",
        bindGroupLayouts: [cameraLayout],
      }),
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
   * Uploads the camera's `view_proj` to the GPU. Call it whenever the camera
   * changes; `wasmMemoryFn` defaults to the engine's own Wasm memory.
   */
  updateCamera(
    wasmCamera: Camera,
    wasmMemoryFn: () => WebAssembly.Memory = () => wasm_memory() as WebAssembly.Memory,
  ): void {
    this.cameraUniform.syncFromWasmCamera(wasmCamera, wasmMemoryFn);
  }

  /**
   * Uploads the current entity data and draws one frame.
   * Returns the number of instances drawn.
   */
  render(entityManager: EntityManager): number {
    return this.drawFrame(this.syncDenseEntities(entityManager));
  }

  /**
   * Like {@link InstancedRenderer.render}, but draws only the entities inside
   * the camera frustum. Returns the number of instances drawn.
   *
   * When every entity is visible it takes the regular dirty-tracked path, so a
   * fully on-screen, unchanged scene uploads nothing.
   */
  renderCulled(
    entityManager: EntityManager,
    cameraController: CameraController,
    cullingManager: CullingManager,
  ): number {
    cameraController.syncIfDirty(this);
    const visibleCount = cullingManager.cullEntities(entityManager, cameraController);
    const activeCount = entityManager.getActiveCount();

    if (visibleCount === activeCount) {
      return this.drawFrame(this.syncDenseEntities(entityManager));
    }

    if (visibleCount > 0) {
      this.holdsCulledSubset = true;
      this.instanceBuffers.syncFromVisibleViews(cullingManager.getVisibleViews());
    }
    return this.drawFrame(visibleCount);
  }

  /**
   * Dirty-tracked upload of all entities. If the buffers last held a culled
   * subset they no longer mirror the dense arrays, so everything is re-sent.
   */
  private syncDenseEntities(entityManager: EntityManager): number {
    if (this.holdsCulledSubset) {
      entityManager.getDirtyTracker().markAllDirty(entityManager.getActiveCount());
      this.holdsCulledSubset = false;
    }
    return this.instanceBuffers.syncFromEntities(entityManager);
  }

  /** Clears the screen and draws `instanceCount` instances from the bound buffers. */
  private drawFrame(instanceCount: number): number {
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
      pass.setBindGroup(0, this.cameraUniform.bindGroup);
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
    this.cameraUniform.destroy();
  }
}
