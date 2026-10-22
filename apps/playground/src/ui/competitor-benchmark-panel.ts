import { renderBenchmarkMarkdown } from '../benchmark/report/benchmark-markdown.ts'
import type {
  CompetitorBenchmarkReport, CompetitorWorkloadResult, ScaleReport, WorkloadReport,
} from '../benchmark/report/benchmark-report.types.ts'
import {
  bestRivalBytes, bytesPerFrame, isFrameWorkload, isO3dVariant, speedupVsO3d,
} from '../benchmark/report/report-comparisons.ts'
import { formatBytes, formatCount, formatMs } from './format.ts'

/**
 * Modal dashboard for the competitor benchmark: a live progress bar while it
 * runs, then per-workload tables with P50 bars, percentiles, bandwidth, draw
 * load and speedup badges, plus JSON / Markdown export.
 */
export class CompetitorBenchmarkPanel {
  private readonly overlay: HTMLElement
  private readonly body: HTMLElement
  private report: CompetitorBenchmarkReport | null = null

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    this.overlay.dataset.testid = 'benchmark-panel'
    const dialog = document.createElement('div')
    dialog.className = 'modal wide'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-label', 'Competitor benchmark')
    const header = document.createElement('header')
    header.innerHTML = '<h2>O3d vs. Three.js vs. JS scene graph</h2>'
    const actions = document.createElement('div')
    actions.className = 'modal-actions'
    actions.append(
      this.button('Export JSON', 'export-json', () => this.download('json')),
      this.button('Export Markdown', 'export-markdown', () => this.download('md')),
      this.button('Close', 'close-benchmark', () => (this.overlay.hidden = true)),
    )
    header.append(actions)
    this.body = document.createElement('div')
    dialog.append(header, this.body)
    this.overlay.append(dialog)
    container.append(this.overlay)
  }

  showProgress(fraction: number, message: string): void {
    this.overlay.hidden = false
    this.overlay.dataset.state = 'running'
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-testid^=export]').forEach((b) => (b.disabled = true))
    const percent = Math.round(fraction * 100)
    this.body.innerHTML = `
      <p class="muted">Running 5 workloads × 5 engines. Every engine is set up fresh from the same dataset for each workload.</p>
      <div class="progress-track" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width:${percent}%"></div>
      </div>
      <p class="progress-label"><strong>${percent}%</strong> <span></span></p>`
    this.body.querySelector('.progress-label span')!.textContent = message
  }

  showError(message: string): void {
    this.overlay.hidden = false
    this.overlay.dataset.state = 'error'
    this.body.innerHTML = '<p class="error"></p>'
    this.body.querySelector('p')!.textContent = message
  }

  showReport(report: CompetitorBenchmarkReport): void {
    this.report = report
    this.overlay.hidden = false
    this.overlay.dataset.state = 'done'
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-testid^=export]').forEach((b) => (b.disabled = false))
    const { environment: env } = report
    const backend = env.backend === 'webgpu' ? 'real WebGPU device, shared by every engine' : 'headless: CPU only, Three.js render() skipped'
    this.body.innerHTML = `<p class="muted small">${backend} · ${env.warmupFrames} warm-up + ${env.measuredFrames} measured frames · picking ${env.pickQueries} queries</p>`
    const scale = report.scales[report.scales.length - 1]!
    if (report.scales.length > 1) this.body.append(this.scaleTabs(report))
    const content = document.createElement('div')
    content.className = 'scale-content'
    content.append(this.renderScale(scale))
    this.body.append(content)
  }

  private scaleTabs(report: CompetitorBenchmarkReport): HTMLElement {
    const tabs = document.createElement('div')
    tabs.className = 'segmented scale-tabs'
    report.scales.forEach((scale, i) => {
      const tab = this.button(`${formatCount(scale.entityCount)}`, `scale-${scale.entityCount}`, () => {
        tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
        tab.classList.add('active')
        this.body.querySelector('.scale-content')!.replaceChildren(this.renderScale(scale))
      })
      if (i === report.scales.length - 1) tab.classList.add('active')
      tabs.append(tab)
    })
    return tabs
  }

  private renderScale(scale: ScaleReport): HTMLElement {
    const section = document.createElement('section')
    section.innerHTML = `<p class="muted">${formatCount(scale.entityCount)} entities · deep-zoom camera sees ${(scale.zoomVisibleFraction * 100).toFixed(1)}%</p>`
    for (const workload of scale.workloads) section.append(this.renderWorkload(workload))
    section.append(this.renderFootprint(scale))
    return section
  }

  private renderWorkload(workload: WorkloadReport): HTMLElement {
    const card = document.createElement('article')
    card.className = 'workload-card'
    const frames = isFrameWorkload(workload)
    const slowest = Math.max(...workload.results.map((r) => r.cpuMs.p50), 1e-9)
    const rows = workload.results.map((r) => {
      const width = Math.max(1, (r.cpuMs.p50 / slowest) * 100)
      const extra = frames
        ? `<td>${r.gpuInclusiveMs ? formatMs(r.gpuInclusiveMs.p50) : 'n/a'}</td>
           <td>${formatBytes(bytesPerFrame(r))}${bytesBadge(workload, r)}</td>
           <td>${formatCount(r.drawnInstancesPerFrame)}${drawBadge(workload, r)}</td>`
        : ''
      return `<tr class="${r.competitor === 'o3d' ? 'ours' : ''}">
        <td class="engine">${escapeHtml(r.label)}</td>
        <td class="bar-cell"><div class="bar"><span style="width:${width}%"></span></div>${formatMs(r.cpuMs.p50)}</td>
        <td>${formatMs(r.cpuMs.p95)}</td><td>${formatMs(r.cpuMs.p99)}</td>${extra}
        <td>${speedBadge(workload, r)}</td></tr>`
    }).join('')
    card.innerHTML = `
      <h3>${escapeHtml(workload.title)}</h3><p class="muted small">${escapeHtml(workload.description)}</p>
      <div class="table-scroll"><table class="results">
        <thead><tr><th>Engine</th><th>${frames ? 'CPU P50' : 'Latency P50'}</th><th>P95</th><th>P99</th>
        ${frames ? '<th>GPU-incl. P50</th><th>Bytes / frame</th><th>Drawn</th>' : ''}<th>vs. O3d</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${workload.notes.map((n) => `<p class="muted small">${escapeHtml(n)}</p>`).join('')}`
    return card
  }

  private renderFootprint(scale: ScaleReport): HTMLElement {
    const card = document.createElement('article')
    card.className = 'workload-card'
    card.innerHTML = `<h3>Memory per entity</h3><div class="table-scroll"><table class="results">
      <thead><tr><th>Engine</th><th>Instance data</th><th>JS heap at setup</th></tr></thead><tbody>
      ${scale.footprints.map((f) => `<tr class="${f.competitor === 'o3d' ? 'ours' : ''}"><td class="engine">${escapeHtml(f.label)}</td>
        <td>${f.instanceBytesPerEntity} B</td>
        <td>${f.setupHeapBytesPerEntity === null ? 'n/a' : `${Math.round(f.setupHeapBytesPerEntity)} B`}</td></tr>`).join('')}
      </tbody></table></div>`
    return card
  }

  private download(kind: 'json' | 'md'): void {
    if (!this.report) return
    const text = kind === 'json' ? `${JSON.stringify(this.report, null, 2)}\n` : renderBenchmarkMarkdown(this.report)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/markdown' }))
    link.download = kind === 'json' ? 'benchmark-results.json' : 'benchmark-results.md'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  private button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.testid = testId
    button.addEventListener('click', onClick)
    return button
  }
}

function speedBadge(workload: WorkloadReport, r: CompetitorWorkloadResult): string {
  if (r.competitor === 'o3d') return '<span class="pill neutral">reference</span>'
  if (isO3dVariant(r)) return '<span class="pill neutral">same engine</span>'
  const ratio = speedupVsO3d(workload, r)
  if (ratio === null) return ''
  return ratio >= 1
    ? `<span class="pill good">O3d ${ratio.toFixed(1)}× faster</span>`
    : `<span class="pill bad">O3d ${(1 / ratio).toFixed(1)}× slower</span>`
}

/** Only when O3d beats the best rival: "N× less" than the leanest other engine. */
function bytesBadge(workload: WorkloadReport, r: CompetitorWorkloadResult): string {
  const best = bestRivalBytes(workload)
  const ours = bytesPerFrame(r)
  if (r.competitor !== 'o3d' || best === null || ours >= best) return ''
  return ` <span class="pill good stacked">${(best / Math.max(ours, 1)).toFixed(1)}× less than best rival</span>`
}

function drawBadge(workload: WorkloadReport, r: CompetitorWorkloadResult): string {
  if (r.competitor !== 'o3d' || workload.key !== 'deep-zoom') return ''
  const most = Math.max(...workload.results.map((x) => x.drawnInstancesPerFrame))
  return most > 0 ? ` <span class="pill good stacked">${((1 - r.drawnInstancesPerFrame / most) * 100).toFixed(0)}% culled</span>` : ''
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
