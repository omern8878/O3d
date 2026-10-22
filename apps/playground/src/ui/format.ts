const KB = 1024
const MB = KB * 1024

/** `0 B`, `12.0 KB`, `3.43 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${Math.round(bytes)} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(2)} MB`
}

/** `100,000`. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** `0.42 ms`, `12.3 ms`. */
export function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`
}

/** How much smaller `ours` is than `theirs`, e.g. `100% less` or `2.3× faster`. */
export function formatSavings(ours: number, theirs: number, unit: 'time' | 'amount'): string {
  if (theirs <= 0) return '—'
  if (unit === 'time') {
    if (ours <= 0) return '—'
    const ratio = theirs / ours
    return ratio >= 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`
  }
  const saved = 1 - ours / theirs
  if (saved === 1) return '100% less'
  if (saved === 0) return 'same'
  return saved > 0 ? `${(saved * 100).toFixed(1)}% less` : `${(-saved * 100).toFixed(1)}% more`
}
