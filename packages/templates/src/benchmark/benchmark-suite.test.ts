import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import type { BenchmarkReport, WorkloadId, WorkloadResult } from "../types/benchmark.types.ts";

const ENTITY_COUNT = 2000;
const BYTES_PER_NODE = 36;

describe("BenchmarkSuite", () => {
  let report: BenchmarkReport;
  let progress: number[];
  const workload = (id: WorkloadId): WorkloadResult =>
    report.workloads.find((w) => w.id === id)!;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    const { BenchmarkSuite } = await import("./benchmark-suite.ts");

    progress = [];
    report = await new BenchmarkSuite().run(
      { entityCount: ENTITY_COUNT, iterations: 4, warmupIterations: 1 },
      (completed) => progress.push(completed.length),
    );
  });

  it("runs the four workloads in order on a headless backend and reports progress", () => {
    assert.equal(report.backend, "headless");
    assert.equal(report.entityCount, ENTITY_COUNT);
    assert.deepEqual(
      report.workloads.map((w) => w.id),
      ["static-orbit", "localized-animation", "zoomed-culling", "raycast-picking"],
    );
    assert.deepEqual(progress, [1, 2, 3, 4]);
  });

  it("static orbit: O3d uploads 0 instance bytes, the baseline re-sends everything", () => {
    const { o3d, baseline } = workload("static-orbit");
    assert.equal(o3d.bytesPerFrame, 0);
    assert.equal(o3d.drawnInstances, ENTITY_COUNT);
    assert.equal(baseline.bytesPerFrame, ENTITY_COUNT * BYTES_PER_NODE);
  });

  it("localized animation: O3d uploads exactly the 1% slice of positions", () => {
    const { o3d, baseline } = workload("localized-animation");
    assert.equal(o3d.bytesPerFrame, ENTITY_COUNT * 0.01 * 12);
    assert.equal(baseline.bytesPerFrame, ENTITY_COUNT * BYTES_PER_NODE);
  });

  it("zoomed culling: O3d draws and uploads only a small visible set", () => {
    const { o3d, baseline } = workload("zoomed-culling");
    const drawn = o3d.drawnInstances!;
    assert.ok(drawn > 0 && drawn <= ENTITY_COUNT * 0.05, `drew ${drawn}`);
    assert.equal(o3d.bytesPerFrame, drawn * BYTES_PER_NODE);
    assert.equal(baseline.drawnInstances, ENTITY_COUNT);
  });

  it("raycast picking: both pickers agree on every pointer position", () => {
    const { o3d, notes } = workload("raycast-picking");
    assert.equal(o3d.bytesPerFrame, null);
    assert.match(notes[0]!, /25\/25/);
  });

  it("reports finite, non-negative timings everywhere", () => {
    for (const { o3d, baseline } of report.workloads) {
      for (const ms of [o3d.cpuMs, baseline.cpuMs]) {
        assert.ok(Number.isFinite(ms) && ms >= 0);
      }
    }
  });
});
