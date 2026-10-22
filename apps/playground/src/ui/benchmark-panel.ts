import type { BenchmarkReport, EngineMetrics, WorkloadResult } from '@engine/templates'
import { formatBytes, formatCount, formatMs, formatSavings } from './format.ts'

/** Modal that shows benchmark progress and the O3d-vs-baseline comparison table. */
export class BenchmarkPanel {
  private readonly overlay: HTMLElement
  private readonly body: HTMLElement

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    this.overlay.dataset.testid = 'benchmark-panel'

    const dialog = document.createElement('div')
    dialog.className = 'modal'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-label', 'Benchmark results')
    const header = document.createElement('header')
    header.innerHTML = '<h2>O3d vs. JS object graph</h2>'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.dataset.testid = 'close-benchmark'
    close.addEventListener('click', () => (this.overlay.hidden = true))
    header.append(close)
    this.body = document.createElement('div')
    dialog.append(header, this.body)
    this.overlay.append(dialog)
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.overlay.hidden = true
    })
    container.append(this.overlay)
  }

  showRunning(entityCount: number, completed: readonly WorkloadResult[] = []): void {
    this.overlay.hidden = false
    this.overlay.dataset.state = 'running'
    const done = completed.map((w) => `<li>✓ ${w.title}</li>`).join('')
    this.body.innerHTML = `<p class="muted">Running 4 workloads on ${formatCount(entityCount)} entities…</p><ul class="progress">${done}</ul>`
  }

  showError(message: string): void {
    this.overlay.hidden = false
    this.overlay.dataset.state = 'error'
    this.body.innerHTML = `<p class="error"></p>`
    this.body.querySelector('p')!.textContent = message
  }

  showReport(report: BenchmarkReport): void {
    this.overlay.hidden = false
    this.overlay.dataset.state = 'done'
    const backend = report.backend === 'webgpu' ? 'real WebGPU device' : 'headless (CPU only, uploads discarded)'
    const rows = report.workloads.map((w, i) => this.workloadRows(w, i + 1)).join('')
    this.body.innerHTML = `
      <p class="muted">${formatCount(report.entityCount)} entities · median of ${report.iterations} frames · ${backend}</p>
      <div class="table-scroll"><table class="results">
        <thead><tr><th>Workload</th><th>Metric</th><th>O3d</th><th>Baseline</th><th>O3d advantage</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted small">Baseline: an array of JS objects <code>{ id, position, scale, color }</code> repacked into a
      <code>Float32Array</code> and uploaded in full every frame, with no culling.</p>`
  }

  private workloadRows(workload: WorkloadResult, index: number): string {
    const metrics: [string, (m: EngineMetrics) => number | null, (v: number) => string, 'time' | 'amount'][] = [
      [workload.id === 'raycast-picking' ? 'Pick latency' : 'CPU / frame', (m) => m.cpuMs, formatMs, 'time'],
      ['Instance bytes / frame', (m) => m.bytesPerFrame, formatBytes, 'amount'],
      ['Instances drawn', (m) => m.drawnInstances, formatCount, 'amount'],
    ]
    const present = metrics.filter(([, read]) => read(workload.o3d) !== null)
    return present
      .map(([label, read, format, unit], row) => {
        const ours = read(workload.o3d)!
        const theirs = read(workload.baseline)!
        const head = row === 0
          ? `<td rowspan="${present.length}" class="workload"><strong>${index}. ${workload.title}</strong><span>${escape(workload.notes.join(' '))}</span></td>`
          : ''
        return `<tr>${head}<td>${label}</td><td class="ours">${format(ours)}</td><td>${format(theirs)}</td><td>${formatSavings(ours, theirs, unit)}</td></tr>`
      })
      .join('')
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
