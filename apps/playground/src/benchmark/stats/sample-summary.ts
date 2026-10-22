/** Distribution of a measured quantity (e.g. frame time in ms). */
export type SampleSummary = {
  p50: number
  p95: number
  p99: number
  mean: number
  max: number
  samples: number
}

/** Nearest-rank percentiles, mean and max of `values`. */
export function summarize(values: readonly number[]): SampleSummary {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0, max: 0, samples: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
  return {
    p50: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
    max: sorted[sorted.length - 1]!,
    samples: sorted.length,
  }
}
