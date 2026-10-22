import type { FrameStats, InstanceUpload, SceneCameraMode, ShapeMode } from '@engine/templates'
import { createSegmentedControl } from './segmented-control.ts'
import { formatBytes, formatCount, formatMs } from './format.ts'

export type ParticleCount = 20_000 | 50_000 | 100_000

export type HudSettings = {
  cameraMode: SceneCameraMode
  shapeMode: ShapeMode
  count: ParticleCount
  animateTail: boolean
}

export type HudHandlers = {
  onCameraMode(mode: SceneCameraMode): void
  onShapeMode(mode: ShapeMode): void
  onParticleCount(count: ParticleCount): void
  onAnimateTail(animate: boolean): void
  onUploadSvg(file: File): void
  onRestoreCat(): void
  onResetView(): void
  onRunBenchmark(): void
}

/** Per-frame numbers the HUD shows. */
export type HudTelemetry = {
  fps: number
  frameMs: number
  stats: FrameStats
}

const BYTES_PER_VEC3 = 12
const REFRESH_INTERVAL_MS = 150

/**
 * The heads-up display: live telemetry (including the exact instance-buffer
 * writes of the last frame) and the showcase controls.
 */
export class Hud {
  private readonly root: HTMLElement
  private readonly values: Record<string, HTMLElement> = {}
  private readonly uploadList: HTMLElement
  private readonly sourceLabel: HTMLElement
  private readonly restoreButton: HTMLButtonElement
  private readonly status: HTMLElement
  private readonly controls: { set(settings: HudSettings): void }
  private lastRefresh = 0
  private tailRange: [number, number] | null = null

  constructor(container: HTMLElement, settings: HudSettings, handlers: HudHandlers) {
    this.root = document.createElement('aside')
    this.root.className = 'hud'
    this.root.dataset.testid = 'hud'

    const header = document.createElement('header')
    header.className = 'hud-header'
    header.innerHTML = `<div><h1>O3d <span>Vector Cat</span></h1><p>Rust · Wasm · WebGPU</p></div>`
    const badge = this.element('span', 'badge', 'backend')
    const collapse = document.createElement('button')
    collapse.type = 'button'
    collapse.className = 'collapse'
    collapse.setAttribute('aria-label', 'Collapse panel')
    collapse.textContent = '▾'
    collapse.addEventListener('click', () => this.root.classList.toggle('collapsed'))
    header.append(badge, collapse)

    const telemetry = document.createElement('dl')
    telemetry.className = 'telemetry'
    for (const [key, label] of [
      ['fps', 'FPS'],
      ['frame', 'Frame time (CPU)'],
      ['total', 'Total entities'],
      ['visible', 'Visible drawn (frustum culled)'],
      ['bytes', 'Dirty bytes uploaded / frame'],
      ['picked', 'Picked entity'],
    ] as const) {
      const term = document.createElement('dt')
      term.textContent = label
      const value = document.createElement('dd')
      value.dataset.testid = `telemetry-${key}`
      value.textContent = '—'
      this.values[key] = value
      telemetry.append(term, value)
    }
    this.uploadList = this.element('ul', 'uploads', 'upload-list')

    const source = document.createElement('div')
    source.className = 'source-row'
    this.sourceLabel = document.createElement('span')
    this.restoreButton = this.button('Use built-in cat', 'restore-cat', handlers.onRestoreCat)
    this.restoreButton.classList.add('link')
    source.append(this.sourceLabel, this.restoreButton)

    const camera = createSegmentedControl<SceneCameraMode>('Camera', 'camera', [
      { value: 'perspective3d', label: '3D Perspective' },
      { value: 'ortho2d', label: '2D Ortho' },
    ], settings.cameraMode, handlers.onCameraMode)
    const shape = createSegmentedControl<ShapeMode>('Shape', 'shape', [
      { value: 'circle', label: 'SDF Circle' },
      { value: 'quad', label: 'Quad' },
    ], settings.shapeMode, handlers.onShapeMode)
    const count = createSegmentedControl<`${ParticleCount}`>('Particles', 'count', [
      { value: '20000', label: '20k' },
      { value: '50000', label: '50k' },
      { value: '100000', label: '100k' },
    ], `${settings.count}`, (value) => handlers.onParticleCount(Number(value) as ParticleCount))
    const tail = createSegmentedControl<'on' | 'off'>('Tail', 'tail', [
      { value: 'on', label: 'Animate' },
      { value: 'off', label: 'Freeze' },
    ], settings.animateTail ? 'on' : 'off', (value) => handlers.onAnimateTail(value === 'on'))
    this.controls = {
      set: (s) => {
        camera.set(s.cameraMode)
        shape.set(s.shapeMode)
        count.set(`${s.count}`)
        tail.set(s.animateTail ? 'on' : 'off')
      },
    }

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.svg,image/svg+xml'
    fileInput.hidden = true
    fileInput.dataset.testid = 'svg-file-input'
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file) handlers.onUploadSvg(file)
      fileInput.value = ''
    })
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(
      this.button('Upload Custom SVG', 'upload-svg', () => fileInput.click()),
      this.button('Reset View', 'reset-view', handlers.onResetView),
      fileInput,
    )
    const benchmark = this.button('Run 100k Benchmark', 'run-benchmark', handlers.onRunBenchmark)
    benchmark.classList.add('primary')

    this.status = this.element('p', 'status', 'status')
    const hint = document.createElement('p')
    hint.className = 'hint'
    hint.textContent = 'Drag to orbit · Shift / right-drag to pan · Wheel or pinch to zoom · Click a part to pick it'

    const controls = document.createElement('section')
    controls.className = 'controls'
    controls.append(camera.element, shape.element, count.element, tail.element, actions, benchmark)

    this.root.append(header, telemetry, this.uploadList, source, controls, this.status, hint)
    container.append(this.root)
  }

  setBackend(kind: 'webgpu' | 'canvas2d', detail: string): void {
    const badge = this.values.backend!
    badge.textContent = kind === 'webgpu' ? 'WebGPU' : 'Canvas2D preview'
    badge.className = `badge ${kind}`
    badge.title = kind === 'webgpu' ? detail : `No WebGPU adapter: ${detail}`
    document.body.dataset.backend = kind
  }

  setSettings(settings: HudSettings): void {
    this.controls.set(settings)
  }

  /** Names the SVG on screen and the tail slice the animation writes. */
  setSource(label: string, isBuiltIn: boolean, tailRange: [number, number] | null): void {
    this.sourceLabel.textContent = `Source: ${label}`
    this.restoreButton.hidden = isBuiltIn
    this.tailRange = tailRange
  }

  setPicked(text: string): void {
    this.values.picked!.textContent = text
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message
    this.status.classList.toggle('error', isError)
  }

  /** Refreshes telemetry (throttled so the text stays readable). */
  update(now: number, { fps, frameMs, stats }: HudTelemetry): void {
    if (now - this.lastRefresh < REFRESH_INTERVAL_MS) return
    this.lastRefresh = now
    this.values.fps!.textContent = fps > 0 ? fps.toFixed(0) : '—'
    this.values.frame!.textContent = formatMs(frameMs)
    this.values.total!.textContent = formatCount(stats.totalCount)
    const culled = stats.totalCount - stats.drawnCount
    this.values.visible!.textContent =
      `${formatCount(stats.drawnCount)}${culled > 0 ? `  (−${formatCount(culled)} culled)` : ''}`
    this.values.bytes!.textContent = formatBytes(stats.uploadedBytes)
    this.values.bytes!.classList.toggle('zero', stats.uploadedBytes === 0)
    this.renderUploads(stats.uploads)
  }

  private renderUploads(uploads: readonly InstanceUpload[]): void {
    const lines = uploads.length === 0
      ? ['No instance writes: every static particle uploads 0 B']
      : uploads.map((upload) => this.describeUpload(upload))
    this.uploadList.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement('li')
        item.textContent = line
        return item
      }),
    )
  }

  private describeUpload({ channel, byteOffset, byteLength }: InstanceUpload): string {
    const first = byteOffset / BYTES_PER_VEC3
    const last = first + byteLength / BYTES_PER_VEC3 - 1
    const isTail = this.tailRange !== null && first === this.tailRange[0] && last === this.tailRange[1] - 1
    return `${channel} [${formatCount(first)}…${formatCount(last)}] ${formatBytes(byteLength)}${isTail ? ' · tail slice' : ''}`
  }

  private element(tag: string, className: string, key: string): HTMLElement {
    const element = document.createElement(tag)
    element.className = className
    element.dataset.testid = key
    this.values[key] = element
    return element
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
