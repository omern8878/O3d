import type { WorkloadResult } from "../../types/benchmark.types.ts";
import { measureMedianMs } from "../frame-timer.ts";
import { resetOverviewCamera } from "./benchmark-camera.ts";
import { MeasuredAverage, type WorkloadContext } from "./workload-context.ts";

/** Radians the camera orbits per frame. */
const ORBIT_STEP = 0.004;

/**
 * Workload 1: the camera orbits a scene whose entities never change. O3d only
 * re-sends the 64-byte camera uniform; the baseline repacks and re-uploads
 * every node because it cannot tell nothing changed.
 */
export function runStaticOrbitWorkload(ctx: WorkloadContext): WorkloadResult {
  const { scene, baseline, iterations, warmup } = ctx;
  resetOverviewCamera(scene);
  scene.renderFrame();

  const o3dBytes = new MeasuredAverage(warmup);
  const o3dDrawn = new MeasuredAverage(warmup);
  const o3dMs = measureMedianMs(iterations, warmup, (i) => {
    scene.getCameraController().orbit(ORBIT_STEP, 0);
    scene.renderFrame();
    const stats = scene.getFrameStats();
    o3dBytes.add(i, stats.uploadedBytes);
    o3dDrawn.add(i, stats.drawnCount);
  });

  const baselineBytes = new MeasuredAverage(warmup);
  const baselineMs = measureMedianMs(iterations, warmup, (i) => {
    baselineBytes.add(i, baseline.packAndUpload());
  });

  return {
    id: "static-orbit",
    title: "Static scene, orbiting camera",
    description: "Camera orbits every frame; no entity changes.",
    o3d: { cpuMs: o3dMs, bytesPerFrame: o3dBytes.value, drawnInstances: o3dDrawn.value },
    baseline: {
      cpuMs: baselineMs,
      bytesPerFrame: baselineBytes.value,
      drawnInstances: baseline.nodes.length,
    },
    notes: ["O3d sends only the 64-byte camera uniform (not counted as instance bytes)."],
  };
}
