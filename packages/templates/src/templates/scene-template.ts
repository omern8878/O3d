import { CameraController } from "../scene/camera-controller.ts";
import { CullingManager } from "../scene/culling-manager.ts";
import { EntityManager } from "../scene/entity-manager.ts";
import { PickingController } from "../scene/picking-controller.ts";
import { GpuContext } from "../renderer/gpu-context.ts";
import { InstancedRenderer } from "../renderer/instanced-renderer.ts";
import type { EntityAttributeArrays, EntityId, Vec3Tuple } from "../types/entity.types.ts";
import type { FrameStats } from "../types/frame-stats.types.ts";
import type { ViewportRect } from "../types/picking.types.ts";
import type { ReadonlyRawEntityViews } from "../types/readonly-buffer.types.ts";
import type { RendererConfig, ShapeMode } from "../types/renderer.types.ts";
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
  private lastDrawnCount = 0;

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

  /**
   * Adds many nodes at once from flat arrays (`x, y, z` per node for
   * positions and scales, `r, g, b` for colors) and returns their IDs in
   * order. Far faster than repeated {@link SceneTemplate.addNode} for large
   * scenes: one Wasm call and one bulk copy per attribute.
   *
   * @throws {RangeError} if `positions` is not whole triplets, or `scales` /
   * `colors` do not match its length.
   */
  addNodes(nodes: EntityAttributeArrays & { positions: ArrayLike<number> }): Uint32Array {
    const count = nodes.positions.length / 3;
    if (!Number.isInteger(count)) {
      throw new RangeError("positions must hold x, y, z for every node.");
    }
    return this.entities.createEntities(count, nodes);
  }

  /**
   * Overwrites consecutive nodes starting at view index `start`: the same
   * indexing as {@link SceneTemplate.getNodeViews}, which is insertion order
   * until a node is removed. Only the written range is uploaded next frame.
   * Use it to animate whole groups of nodes (morphs, waves) with one copy.
   *
   * @throws {RangeError} if the range does not fit the scene's nodes.
   */
  writeNodeViews(start: number, nodes: EntityAttributeArrays): void {
    this.entities.writeRange(start, nodes);
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
      this.lastDrawnCount = this.renderer.renderCulled(
        this.entities,
        this.camera,
        this.culling,
      );
    } else {
      this.camera.syncIfDirty(this.renderer);
      this.lastDrawnCount = this.renderer.render(this.entities);
    }
    return this.lastDrawnCount;
  }

  /**
   * What the last {@link SceneTemplate.renderFrame} drew and uploaded. An
   * unchanged scene reports `uploadedBytes: 0`; editing a few nodes reports
   * just their slice.
   */
  getFrameStats(): FrameStats {
    const uploads = this.renderer.getLastFrameUploads();
    return {
      drawnCount: this.lastDrawnCount,
      totalCount: this.entities.getActiveCount(),
      uploadedBytes: uploads.reduce((sum, upload) => sum + upload.byteLength, 0),
      uploads,
    };
  }

  /** Switches the camera projection, keeping its position and target. */
  setCameraMode(mode: SceneCameraMode): void {
    this.camera.setMode(CAMERA_MODES[mode]);
  }

  /** Switches how nodes are drawn from the next frame on. */
  setShapeMode(shapeMode: ShapeMode): void {
    this.renderer.setShapeMode(shapeMode);
  }

  getShapeMode(): ShapeMode {
    return this.renderer.getShapeMode();
  }

  /**
   * Read-only zero-copy views of every node's position, scale and color, in
   * insertion order until nodes are removed. Valid until the next `addNode`.
   */
  getNodeViews(): ReadonlyRawEntityViews {
    return this.entities.getRawViews();
  }

  /** The camera, for pan / zoom / orbit / resize. */
  getCameraController(): CameraController {
    return this.camera;
  }

  getActiveCount(): number {
    return this.entities.getActiveCount();
  }

  /**
   * Frees the GPU buffers and the scene's Wasm memory (entities, camera,
   * culling and picking state). The scene must not be used afterwards.
   */
  destroy(): void {
    this.renderer.destroy();
    this.culling?.destroy();
    this.picking.destroy();
    this.camera.destroy();
    this.entities.destroy();
  }
}

function toVec3([x, y, z]: Vec3Tuple): { x: number; y: number; z: number } {
  return { x, y, z };
}

function toColor([r, g, b]: Vec3Tuple): { r: number; g: number; b: number } {
  return { r, g, b };
}
