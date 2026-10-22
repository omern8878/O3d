import type { WorkloadResult } from "../../types/benchmark.types.ts";
import { measureMedianMs } from "../frame-timer.ts";
import { resetOverviewCamera } from "./benchmark-camera.ts";
import { MeasuredAverage, type WorkloadContext } from "./workload-context.ts";

const WAVE_AMPLITUDE = 2;
const WAVE_SPEED = 0.2;
const WAVE_PHASE_PER_NODE = 0.05;

/**
 * Workload 2: a contiguous slice of nodes (1% by default) moves every frame.
 * O3d uploads just that slice's positions; the baseline repacks everything.
 */
export function runLocalizedAnimationWorkload(ctx: WorkloadContext): WorkloadResult {
  const { scene, baseline, points, iterations, warmup, animatedSlice } = ctx;
  const { start, end } = animatedSlice;
  const waveY = (id: number, frame: number) =>
    points[id]!.position[1] +
    Math.sin(frame * WAVE_SPEED + id * WAVE_PHASE_PER_NODE) * WAVE_AMPLITUDE;

  resetOverviewCamera(scene);
  scene.renderFrame();

  const o3dBytes = new MeasuredAverage(warmup);
  const o3dDrawn = new MeasuredAverage(warmup);
  const o3dMs = measureMedianMs(iterations, warmup, (frame) => {
    for (let id = start; id < end; id++) {
      const [x, , z] = points[id]!.position;
      scene.updateNodePosition(id, [x, waveY(id, frame), z]);
    }
    scene.renderFrame();
    const stats = scene.getFrameStats();
    o3dBytes.add(frame, stats.uploadedBytes);
    o3dDrawn.add(frame, stats.drawnCount);
  });

  const baselineBytes = new MeasuredAverage(warmup);
  const baselineMs = measureMedianMs(iterations, warmup, (frame) => {
    for (let id = start; id < end; id++) {
      baseline.nodes[id]!.position.y = waveY(id, frame);
    }
    baselineBytes.add(frame, baseline.packAndUpload());
  });

  return {
    id: "localized-animation",
    title: "Localized animation (contiguous slice)",
    description: `${end - start} contiguous nodes move every frame.`,
    o3d: { cpuMs: o3dMs, bytesPerFrame: o3dBytes.value, drawnInstances: o3dDrawn.value },
    baseline: {
      cpuMs: baselineMs,
      bytesPerFrame: baselineBytes.value,
      drawnInstances: baseline.nodes.length,
    },
    notes: [`Animated slice: node IDs ${start}..${end - 1}.`],
  };
}
