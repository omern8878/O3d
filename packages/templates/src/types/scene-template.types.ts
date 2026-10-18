import type { ShapeMode } from "./renderer.types.ts";

/** Projection used by a `SceneTemplate`'s camera. */
export type SceneCameraMode = "ortho2d" | "perspective3d";

/** Options for building a `SceneTemplate`. Every field is optional. */
export type SceneTemplateConfig = {
  /** Entities to make room for up front; storage still grows on demand. Default `1000`. */
  initialCapacity?: number;
  /** Camera projection. Default `'ortho2d'`. */
  cameraMode?: SceneCameraMode;
  /** Draw only entities inside the camera frustum. Default `true`. */
  enableCulling?: boolean;
  /** How nodes are drawn. Default `'circle'`. */
  shapeMode?: ShapeMode;
};
