import type { SceneTemplate } from "../../templates/scene-template.ts";
import type { GeneratedPoint } from "../point-cloud-generator.ts";
import type { ObjectGraphScene } from "../object-graph-scene.ts";

/** The two scenes, holding the same points, plus the run settings. */
export type WorkloadContext = {
  readonly scene: SceneTemplate;
  readonly baseline: ObjectGraphScene;
  readonly points: readonly GeneratedPoint[];
  readonly iterations: number;
  readonly warmup: number;
  /** Contiguous node IDs `[start, end)` animated by workload 2. */
  readonly animatedSlice: { readonly start: number; readonly end: number };
  /** Visible share the zoomed-in camera aims for in workload 3. */
  readonly targetVisibleFraction: number;
};

/**
 * Sums a per-frame quantity over the measured iterations only, so warm-up
 * frames do not skew the average.
 */
export class MeasuredAverage {
  private readonly warmup: number;
  private total = 0;
  private samples = 0;

  constructor(warmup: number) {
    this.warmup = warmup;
  }

  add(iteration: number, value: number): void {
    if (iteration >= this.warmup) {
      this.total += value;
      this.samples += 1;
    }
  }

  get value(): number {
    return this.samples === 0 ? 0 : this.total / this.samples;
  }
}
