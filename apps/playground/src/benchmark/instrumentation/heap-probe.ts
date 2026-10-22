type ChromiumPerformance = Performance & { memory?: { usedJSHeapSize: number } }

/**
 * Reads the JS heap size where Chromium exposes it (`performance.memory`),
 * collecting garbage first when the page runs with `--js-flags=--expose-gc`.
 * Values are coarse unless Chrome runs with `--enable-precise-memory-info`.
 */
export function readHeapBytes(): number | null {
  ;(globalThis as { gc?: () => void }).gc?.()
  const memory = (performance as ChromiumPerformance).memory
  return memory ? memory.usedJSHeapSize : null
}
