/**
 * Splits `total` into integers proportional to `weights` (largest-remainder
 * method), so the parts always sum to exactly `total`.
 */
export function allocateByWeight(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + Math.max(w, 0), 0)
  if (weightSum <= 0 || total <= 0) return weights.map(() => 0)

  const exact = weights.map((w) => (Math.max(w, 0) / weightSum) * total)
  const counts = exact.map(Math.floor)
  let remaining = total - counts.reduce((sum, c) => sum + c, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (let i = 0; remaining > 0; i = (i + 1) % byRemainder.length, remaining--) {
    counts[byRemainder[i]!.index]! += 1
  }
  return counts
}
