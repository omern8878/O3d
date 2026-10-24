import { wasm_memory, type Camera } from "@engine/core/pkg/engine.js";
import { QuadGeometry } from "../geometry/quad-geometry.ts";
import type { CameraController } from "../scene/camera-controller.ts";
import type { CullingManager } from "../scene/culling-manager.ts";
import type { EntityManager } from "../scene/entity-manager.ts";
import type { InstanceUpload } from "../types/frame-stats.types.ts";
import type { ShapeMode } from "../types/renderer.types.ts";
import { CameraUniformBuffer } from "./camera-uniform-buffer.ts";
import { GpuInstanceBuffers } from "./gpu-buffer-sync.ts";
import type { GpuContext } from "./gpu-context.ts";
import { shaderStage } from "./gpu-flags.ts";
import { createInstancedPipeline } from "./instanced-pipeline.ts";
import { INSTANCED_QUAD_WGSL } from "./shaders/instanced-quad.wgsl.ts";
import { UploadMeter } from "./upload-meter.ts";

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

/**
 * Draws every entity as an instanced, colored shape in a single draw call:
 * a crisp quad (the default) or an anti-aliased SDF disc, see {@link ShapeMode}.
 *
 * Bind group 0 holds the camera `view_proj` uniform (identity until
 * {@link InstancedRenderer.updateCamera} is called). Vertex buffer slots:
 * 0 = quad corners (per vertex), 1 = positions, 2 = scales, 3 = colors (per
 * instance).
 */
export class InstancedRenderer {
  private readonly gpuContext: GpuContext;
  private readonly quadGeometry: QuadGeometry;
  private readonly instanceBuffers: GpuInstanceBuffers;
  private readonly cameraUniform: CameraUniformBuffer;
  private readonly shaderModule: GPUShaderModule;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly pipelines = new Map<ShapeMode, GPURenderPipeline>();
  private readonly uploadMeter = new UploadMeter();
  private shapeMode: ShapeMode;
  private pipeline: GPURenderPipeline;
  /** Whether the instance buffers currently hold a culled subset, not the dense arrays. */
  private holdsCulledSubset = false;
  /** Visible / active counts of the culled subset the buffers hold. */
  private culledVisibleCount = 0;
  private culledActiveCount = 0;

  constructor(
    gpuContext: GpuContext,
    initialCapacity: number = 1000,
    shapeMode: ShapeMode = "quad",
  ) {
    this.gpuContext = gpuContext;
    const { device } = gpuContext;

    this.quadGeometry = new QuadGeometry(device);
    this.instanceBuffers = new GpuInstanceBuffers(device, initialCapacity, this.uploadMeter);

    const cameraLayout = device.createBindGroupLayout({
      label: "camera-bind-group-layout",
      entries: [
        {
          binding: 0,
          visibility: shaderStage().VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.cameraUniform = new CameraUniformBuffer(device, cameraLayout);
    this.cameraUniform.writeRawMatrix(IDENTITY_MATRIX);

    this.shaderModule = device.createShaderModule({
      label: "instanced-quad-shader",
      code: INSTANCED_QUAD_WGSL,
    });
    this.pipelineLayout = device.createPipelineLayout({
      label: "instanced-quad-pipeline-layout",
      bindGroupLayouts: [cameraLayout],
    });
    this.shapeMode = shapeMode;
    this.pipeline = this.pipelineFor(shapeMode);
  }

  /** The shape each instance is currently drawn as. */
  getShapeMode(): ShapeMode {
    return this.shapeMode;
  }

  /**
   * Switches how instances are drawn from the next frame on. Each shape's
   * pipeline is built once, on first use, and reused afterwards.
   */
  setShapeMode(shapeMode: ShapeMode): void {
    this.shapeMode = shapeMode;
    this.pipeline = this.pipelineFor(shapeMode);
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
   * The instance-buffer writes made by the last `render` / `renderCulled`
   * call (empty when nothing was uploaded).
   */
  getLastFrameUploads(): readonly InstanceUpload[] {
    return this.uploadMeter.getUploads();
  }

  /**
   * Uploads the current entity data and draws one frame.
   * Returns the number of instances drawn.
   */
  render(entityManager: EntityManager): number {
    this.uploadMeter.beginFrame();
    return this.drawFrame(this.syncDenseEntities(entityManager));
  }

  /**
   * Like {@link InstancedRenderer.render}, but draws only the entities inside
   * the camera frustum. Returns the number of instances drawn.
   *
   * When every entity is visible it takes the regular dirty-tracked path, so a
   * fully on-screen, unchanged scene uploads nothing. A partially visible
   * scene is re-culled and re-uploaded only when the camera or the entities
   * changed, so an unchanged zoomed-in frame uploads nothing either.
   *
   * Before culling, the whole scene's bounding volume is classified against
   * the frustum in O(1). Fully inside: the per-entity cull and stream
   * compaction are skipped and the dense, dirty-tracked buffers are drawn
   * directly. Fully outside: nothing is culled, uploaded or drawn (pending
   * edits stay tracked for when the scene comes back into view).
   */
  renderCulled(
    entityManager: EntityManager,
    cameraController: CameraController,
    cullingManager: CullingManager,
  ): number {
    this.uploadMeter.beginFrame();
    const cameraChanged = cameraController.syncIfDirty(this);
    const activeCount = entityManager.getActiveCount();
    const dirtyTracker = entityManager.getDirtyTracker();

    const culledSubsetIsCurrent =
      this.holdsCulledSubset &&
      !cameraChanged &&
      activeCount === this.culledActiveCount &&
      dirtyTracker.isClean(activeCount);
    if (culledSubsetIsCurrent) {
      return this.drawFrame(this.culledVisibleCount);
    }

    const sceneVisibility = cullingManager.classifyScene(entityManager, cameraController);
    if (sceneVisibility === "visible") {
      return this.drawFrame(this.syncDenseEntities(entityManager));
    }
    if (sceneVisibility === "hidden") {
      return this.drawFrame(0);
    }

    const visibleCount = cullingManager.cullEntities(entityManager, cameraController);
    if (visibleCount === activeCount) {
      return this.drawFrame(this.syncDenseEntities(entityManager));
    }

    this.instanceBuffers.syncFromVisibleViews(cullingManager.getVisibleViews());
    this.holdsCulledSubset = true;
    this.culledVisibleCount = visibleCount;
    this.culledActiveCount = activeCount;
    // The subset was just rebuilt from current data, and returning to the
    // dense path re-sends everything, so pending dirty ranges are obsolete.
    dirtyTracker.clear();
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

  private pipelineFor(shapeMode: ShapeMode): GPURenderPipeline {
    let pipeline = this.pipelines.get(shapeMode);
    if (!pipeline) {
      pipeline = createInstancedPipeline({
        device: this.gpuContext.device,
        shaderModule: this.shaderModule,
        pipelineLayout: this.pipelineLayout,
        colorFormat: this.gpuContext.format,
        shapeMode,
      });
      this.pipelines.set(shapeMode, pipeline);
    }
    return pipeline;
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
