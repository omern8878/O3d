import type { SceneTemplate } from "../../templates/scene-template.ts";
import { POINT_CLOUD_RADIUS } from "../point-cloud-generator.ts";

/**
 * Far enough that the whole ball fits the 45 degree field of view
 * (`radius / sin(22.5°)` is about 2.6 radii) with margin to orbit.
 */
const OVERVIEW_DISTANCE = POINT_CLOUD_RADIUS * 3.5;

/**
 * Puts the perspective camera back on the +Z axis looking at the origin, so
 * every point is in view.
 */
export function resetOverviewCamera(scene: SceneTemplate): void {
  const camera = scene.getCameraController();
  camera.resize(1, 1);
  camera.setTarget(0, 0, 0);
  camera.setPosition(0, 0, OVERVIEW_DISTANCE);
}
