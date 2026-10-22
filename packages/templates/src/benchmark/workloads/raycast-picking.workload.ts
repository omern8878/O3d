import { pickObjectGraph } from "../object-graph-picker.ts";
import type { WorkloadResult } from "../../types/benchmark.types.ts";
import { measureMedianMs } from "../frame-timer.ts";
import { resetOverviewCamera } from "./benchmark-camera.ts";
import type { WorkloadContext } from "./workload-context.ts";

/** Pointer positions (NDC) cycled through by the picks: a 5 x 5 grid. */
const GRID_SIDE = 5;
const GRID_EXTENT = 0.5;
const PICK_POINTS: readonly [number, number][] = Array.from(
  { length: GRID_SIDE * GRID_SIDE },
  (_, i) => [
    ((i % GRID_SIDE) / (GRID_SIDE - 1)) * 2 * GRID_EXTENT - GRID_EXTENT,
    (Math.floor(i / GRID_SIDE) / (GRID_SIDE - 1)) * 2 * GRID_EXTENT - GRID_EXTENT,
  ],
);

/**
 * Workload 4: pointer picks through the inverse view-projection matrix. O3d
 * ray-tests the packed Wasm arrays; the baseline does the same math over its
 * object graph. Both must return the same node.
 */
export function runRaycastPickingWorkload(ctx: WorkloadContext): WorkloadResult {
  const { scene, baseline, iterations, warmup } = ctx;
  resetOverviewCamera(scene);
  scene.renderFrame();
  const viewProj = new Float32Array(scene.getCameraController().getViewProjection());
  const pointAt = (i: number) => PICK_POINTS[i % PICK_POINTS.length]!;

  const o3dMs = measureMedianMs(iterations, warmup, (i) => {
    const [x, y] = pointAt(i);
    scene.pickNodeByNdc(x, y);
  });
  const baselineMs = measureMedianMs(iterations, warmup, (i) => {
    const [x, y] = pointAt(i);
    pickObjectGraph(baseline.nodes, viewProj, x, y);
  });

  const agreeing = PICK_POINTS.filter(
    ([x, y]) => scene.pickNodeByNdc(x, y) === pickObjectGraph(baseline.nodes, viewProj, x, y),
  ).length;

  return {
    id: "raycast-picking",
    title: "Raycast picking (inverse view-projection)",
    description: "One pointer pick against every node.",
    o3d: { cpuMs: o3dMs, bytesPerFrame: null, drawnInstances: null },
    baseline: { cpuMs: baselineMs, bytesPerFrame: null, drawnInstances: null },
    notes: [`Both pickers returned the same node for ${agreeing}/${PICK_POINTS.length} pointer positions.`],
  };
}
