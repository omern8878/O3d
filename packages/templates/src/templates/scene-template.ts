import { CameraController } from "../scene/camera-controller.ts";
import { CullingManager } from "../scene/culling-manager.ts";
import { EntityManager } from "../scene/entity-manager.ts";
import { PickingController } from "../scene/picking-controller.ts";
import { GpuContext } from "../renderer/gpu-context.ts";
import { InstancedRenderer } from "../renderer/instanced-renderer.ts";
import type { EntityId, Vec3Tuple } from "../types/entity.types.ts";
import type { ViewportRect } from "../types/picking.types.ts";
import type { RendererConfig } from "../types/renderer.types.ts";
import type {
  SceneCameraMode,
  SceneTemplateConfig,
} from "../types/scene-template.types.ts";
import type { CameraMode } from "../types/camera.types.ts";

const DEFAULT_INITIAL_CAPACITY = 1000;
const DEFAULT_CAMERA_MODE: SceneCameraMode = "ortho2d";
const DEFAULT_SHAPE_MODE = "circle";

const CAMERA_MODES: Record<SceneCameraMode, CameraMode> = {
  ortho2d: "2d",
  perspective3d: "3d",
};

/**
 * One-stop facade for a drawable scene of nodes (points, graph vertices, dots).
 *
 * It wires the entity store, camera, culling, picking and instanced renderer
 * together so callers deal only with node IDs, tuples and a per-frame
 * {@link SceneTemplate.renderFrame}. Use {@link SceneTemplate.create} in the
 * browser; the constructor takes an existing `GpuContext`. The Wasm module
 * must be initialized first.
 */
export class SceneTemplate {
  private readonly entities: EntityManager;
  private readonly camera: CameraController;
  private readonly picking = new PickingController();
  private readonly renderer: InstancedRenderer;
  /** Present only when culling is enabled. */
  private readonly culling: CullingManager | null;

  constructor(gpuContext: GpuContext, config: SceneTemplateConfig = {}) {
    const capacity = config.initialCapacity ?? DEFAULT_INITIAL_CAPACITY;

    this.entities = new EntityManager(capacity);
    this.camera = new CameraController({
      mode: CAMERA_MODES[config.cameraMode ?? DEFAULT_CAMERA_MODE],
    });
    this.culling = config.enableCulling === false ? null : new CullingManager(capacity);
    this.renderer = new InstancedRenderer(
      gpuContext,
      capacity,
      config.shapeMode ?? DEFAULT_SHAPE_MODE,
    );
  }

  /** Requests a WebGPU device for the canvas and builds a scene on it. */
  static async create(
    config: SceneTemplateConfig & RendererConfig,
  ): Promise<SceneTemplate> {
    const { initialCapacity, cameraMode, enableCulling, shapeMode, ...rendererConfig } =
      config;
    const gpuContext = await GpuContext.create(rendererConfig);
    return new SceneTemplate(gpuContext, {
      initialCapacity,
      cameraMode,
      enableCulling,
      shapeMode,
    });
  }

  /**
   * Adds a node and returns its stable ID. `scale` is the node's size on each
   * axis (a circle's diameter is `scale[0]` by `scale[1]`), and `color` is
   * `[r, g, b]` with each channel in `0..1`.
   */
  addNode(pos: Vec3Tuple, scale: Vec3Tuple, color: Vec3Tuple): EntityId {
    return this.entities.createEntity({
      position: toVec3(pos),
      scale: toVec3(scale),
      color: toColor(color),
    });
  }

  /** Moves a node. Unknown IDs are ignored. */
  updateNodePosition(id: EntityId, pos: Vec3Tuple): void {
    this.entities.updateEntity(id, { position: toVec3(pos) });
  }

  /** Resizes a node. Unknown IDs are ignored. */
  updateNodeScale(id: EntityId, scale: Vec3Tuple): void {
    this.entities.updateEntity(id, { scale: toVec3(scale) });
  }

  /** Recolors a node with `[r, g, b]` in `0..1`. Unknown IDs are ignored. */
  updateNodeColor(id: EntityId, color: Vec3Tuple): void {
    this.entities.updateEntity(id, { color: toColor(color) });
  }

  /** Removes a node. Returns `false` if `id` was not a live node. */
  removeNode(id: EntityId): boolean {
    if (!this.entities.hasEntity(id)) {
      return false;
    }
    this.entities.removeEntity(id);
    return true;
  }

  /**
   * The nearest node under a pointer position, e.g. `event.clientX` /
   * `event.clientY` with the canvas's `getBoundingClientRect()`.
   */
  pickNodeAtScreen(
    clientX: number,
    clientY: number,
    viewportRect: ViewportRect,
  ): EntityId | null {
    return this.picking.pickAtScreenCoords(
      clientX,
      clientY,
      viewportRect,
      this.entities,
      this.camera,
    );
  }

  /** The nearest node at normalized device coordinates (`[-1, 1]`, `+Y` up). */
  pickNodeByNdc(ndcX: number, ndcY: number): EntityId | null {
    return this.picking.pickByNdc(ndcX, ndcY, this.entities, this.camera);
  }

  /**
   * Draws one frame and returns the number of nodes drawn. With culling
   * enabled only nodes inside the camera frustum are drawn and uploaded.
   */
  renderFrame(): number {
    if (this.culling) {
      return this.renderer.renderCulled(this.entities, this.camera, this.culling);
    }
    this.camera.syncIfDirty(this.renderer);
    return this.renderer.render(this.entities);
  }

  /** The camera, for pan / zoom / orbit / resize. */
  getCameraController(): CameraController {
    return this.camera;
  }

  getActiveCount(): number {
    return this.entities.getActiveCount();
  }

  /** Frees the GPU resources. The scene must not be used afterwards. */
  destroy(): void {
    this.renderer.destroy();
  }
}

function toVec3([x, y, z]: Vec3Tuple): { x: number; y: number; z: number } {
  return { x, y, z };
}

function toColor([r, g, b]: Vec3Tuple): { r: number; g: number; b: number } {
  return { r, g, b };
}
