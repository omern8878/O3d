import { cull_spheres, raycast_spheres_ndc } from "@engine/core/pkg/engine.js";
import type { CameraController } from "./camera-controller.ts";

/**
 * Index of the sphere nearest to the camera under the screen point
 * `(ndcX, ndcY)` (`[-1, 1]`, `+Y` up), or `-1` if none is hit. `spheres` is a
 * flat `[x, y, z, radius, ...]` array; ties go to the lower index.
 *
 * The array is copied into Wasm for the call. For instances that already live
 * in Wasm memory, {@link InstancedMesh.raycastNdc} reads them in place.
 */
export function raycastSpheresNdc(
  camera: CameraController,
  ndcX: number,
  ndcY: number,
  spheres: Float32Array,
): number {
  return raycast_spheres_ndc(camera.getRawWasmCamera(), ndcX, ndcY, spheres);
}

/**
 * Ascending indices of the spheres in the flat `[x, y, z, radius, ...]` array
 * that intersect the camera frustum (conservative near frustum corners).
 */
export function cullSpheres(camera: CameraController, spheres: Float32Array): Uint32Array {
  return cull_spheres(camera.getRawWasmCamera(), spheres);
}
