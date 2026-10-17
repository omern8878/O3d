export { EntityManager } from "./scene/entity-manager.ts";
export { GpuContext } from "./renderer/gpu-context.ts";
export { InstancedRenderer } from "./renderer/instanced-renderer.ts";
export { INSTANCED_QUAD_WGSL } from "./renderer/shaders/instanced-quad.wgsl.ts";
export { GpuInstanceBuffers } from "./renderer/gpu-buffer-sync.ts";
export { QuadGeometry } from "./geometry/quad-geometry.ts";
export type {
  ColorInput,
  EntityId,
  EntityTransform,
  RawEntityViews,
  Vec3,
} from "./types/entity.types.ts";
export type { ClearColor, RendererConfig } from "./types/renderer.types.ts";
