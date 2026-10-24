export { default as initEngine } from "@engine/core/pkg/engine.js";
export { CullingManager } from "./scene/culling-manager.ts";
export { CameraController } from "./scene/camera-controller.ts";
export { EntityManager } from "./scene/entity-manager.ts";
export { PickingController } from "./scene/picking-controller.ts";
export { SceneTemplate } from "./templates/scene-template.ts";
export { BenchmarkSuite } from "./benchmark/benchmark-suite.ts";
export { GpuContext } from "./renderer/gpu-context.ts";
export { createHeadlessGpuContext } from "./renderer/headless-gpu-context.ts";
export { InstancedRenderer } from "./renderer/instanced-renderer.ts";
export { INSTANCED_QUAD_WGSL } from "./renderer/shaders/instanced-quad.wgsl.ts";
export { CameraUniformBuffer } from "./renderer/camera-uniform-buffer.ts";
export { GpuInstanceBuffers } from "./renderer/gpu-buffer-sync.ts";
export { QuadGeometry } from "./geometry/quad-geometry.ts";
export type {
  ColorInput,
  EntityAttributeArrays,
  EntityId,
  EntityTransform,
  Vec3,
  Vec3Tuple,
} from "./types/entity.types.ts";
export type { CameraConfig, CameraMode } from "./types/camera.types.ts";
export type {
  ReadonlyFloat32Array,
  ReadonlyRawEntityViews,
  ReadonlyUint32Array,
} from "./types/readonly-buffer.types.ts";
export type { VisibleViews } from "./types/culling.types.ts";
export type { ViewportRect } from "./types/picking.types.ts";
export type {
  SceneCameraMode,
  SceneTemplateConfig,
} from "./types/scene-template.types.ts";
export type { ClearColor, RendererConfig, ShapeMode } from "./types/renderer.types.ts";
export type { FrameStats, InstanceUpload } from "./types/frame-stats.types.ts";
export type {
  BenchmarkOptions,
  BenchmarkReport,
  EngineMetrics,
  WorkloadId,
  WorkloadResult,
} from "./types/benchmark.types.ts";
