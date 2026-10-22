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
