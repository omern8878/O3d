import type { SceneTemplate } from "../../templates/scene-template.ts";
import type { WorkloadResult } from "../../types/benchmark.types.ts";
import { measureMedianMs } from "../frame-timer.ts";
import { POINT_CLOUD_RADIUS } from "../point-cloud-generator.ts";
import { resetOverviewCamera } from "./benchmark-camera.ts";
import { MeasuredAverage, type WorkloadContext } from "./workload-context.ts";

/** Zooming toward a point deep inside the ball leaves only a small cap in view. */
const ZOOM_TARGET_Z = -POINT_CLOUD_RADIUS * 0.6;
const ZOOM_STEP = 0.9;
const MAX_ZOOM_STEPS = 200;
/** A tiny back-and-forth orbit forces a fresh cull every frame without drifting. */
const JITTER_RAD = 0.0005;

/**
 * Workload 3: the camera is zoomed in until roughly 5% of the nodes are
 * visible, and nudged every frame so culling must rerun. O3d culls and
 * compacts in Wasm and draws only the visible set; the baseline has no
 * culling and draws everything.
 */
export function runZoomedCullingWorkload(ctx: WorkloadContext): WorkloadResult {
  const { scene, baseline, iterations, warmup, targetVisibleFraction } = ctx;
  const visibleFraction = zoomUntilVisibleFraction(scene, targetVisibleFraction);

  const o3dBytes = new MeasuredAverage(warmup);
  const o3dDrawn = new MeasuredAverage(warmup);
  const o3dMs = measureMedianMs(iterations, warmup, (frame) => {
    scene.getCameraController().orbit(frame % 2 === 0 ? JITTER_RAD : -JITTER_RAD, 0);
    scene.renderFrame();
    const stats = scene.getFrameStats();
    o3dBytes.add(frame, stats.uploadedBytes);
    o3dDrawn.add(frame, stats.drawnCount);
  });

  const baselineBytes = new MeasuredAverage(warmup);
  const baselineMs = measureMedianMs(iterations, warmup, (frame) => {
    baselineBytes.add(frame, baseline.packAndUpload());
  });

  return {
    id: "zoomed-culling",
    title: "Zoomed-in frustum culling",
    description: "Camera zoomed into the cloud and nudged every frame.",
    o3d: { cpuMs: o3dMs, bytesPerFrame: o3dBytes.value, drawnInstances: o3dDrawn.value },
    baseline: {
      cpuMs: baselineMs,
      bytesPerFrame: baselineBytes.value,
      drawnInstances: baseline.nodes.length,
    },
    notes: [
      `${(visibleFraction * 100).toFixed(1)}% of nodes inside the frustum.`,
      "O3d time includes the Wasm cull, stream compaction and upload; the baseline has no culling.",
    ],
  };
}

/** Zooms toward {@link ZOOM_TARGET_Z} until at most `fraction` of nodes are drawn. */
function zoomUntilVisibleFraction(scene: SceneTemplate, fraction: number): number {
  resetOverviewCamera(scene);
  const camera = scene.getCameraController();
  camera.setTarget(0, 0, ZOOM_TARGET_Z);

  const total = Math.max(scene.getActiveCount(), 1);
  let visible = scene.renderFrame() / total;
  for (let step = 0; step < MAX_ZOOM_STEPS && visible > fraction; step++) {
    camera.zoom(ZOOM_STEP);
    visible = scene.renderFrame() / total;
  }
  return visible;
}
