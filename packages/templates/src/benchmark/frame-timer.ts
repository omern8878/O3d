/**
 * Runs `step(i)` `warmup` times unmeasured, then `iterations` times measured,
 * and returns the median duration in milliseconds. The median ignores
 * one-off stalls (GC, tab switches) that would skew a mean.
 */
export function measureMedianMs(
  iterations: number,
  warmup: number,
  step: (iteration: number) => void,
): number {
  for (let i = 0; i < warmup; i++) {
    step(i);
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    step(warmup + i);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
