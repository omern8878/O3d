import type { FrameStats, InstanceUpload, SceneCameraMode, ShapeMode } from '@engine/templates'
import type { ParticleRequest } from '../cloud/point-cloud.types.ts'
import type { PresetId } from '../presets/preset-catalog.ts'
import { createSegmentedControl } from './segmented-control.ts'
import { formatBytes, formatCount, formatMs } from './format.ts'

/** What moves each frame: one layer, everything, the camera, or nothing. */
export type AnimationMode = 'slice' | 'wave' | 'turntable' | 'freeze'

export type HudSettings = {
  /** `null` while a dropped or uploaded file is shown. */
  preset: PresetId | null
  cameraMode: SceneCameraMode
  shapeMode: ShapeMode
  particles: ParticleRequest
  animation: AnimationMode
}

export type HudHandlers = {
  onPreset(preset: PresetId): void
  onCameraMode(mode: SceneCameraMode): void
  onShapeMode(mode: ShapeMode): void
  onParticles(request: ParticleRequest): void
  onAnimation(mode: AnimationMode): void
  onUpload(file: File): void
  onResetView(): void
  onRunBenchmark(): void
}

/** Per-frame numbers the HUD shows. */
export type HudTelemetry = { fps: number; frameMs: number; stats: FrameStats }

const BYTES_PER_VEC3 = 12
const REFRESH_INTERVAL_MS = 150
const PARTICLE_CHOICES = ['auto', '20000', '100000', '250000', '1000000'] as const
type ParticleChoice = (typeof PARTICLE_CHOICES)[number]

/**
 * The heads-up display: live telemetry (including the exact instance-buffer
 * writes of the last frame) and the showcase controls.
 */
export class Hud {
  private readonly root: HTMLElement
  private readonly values: Record<string, HTMLElement> = {}
  private readonly uploadList: HTMLElement
  private readonly sourceLabel: HTMLElement
  private readonly sourceDetail: HTMLElement
  private readonly status: HTMLElement
  private readonly customParticles: HTMLInputElement
  private readonly controls: { set(settings: HudSettings): void }
  private lastRefresh = 0
  private slice: { name: string; first: number; last: number } | null = null

  constructor(container: HTMLElement, settings: HudSettings, handlers: HudHandlers) {
    this.root = document.createElement('aside')
    this.root.className = 'hud'
    this.root.dataset.testid = 'hud'

    const header = document.createElement('header')
    header.className = 'hud-header'
    header.innerHTML = '<div><h1>O3d <span>Particles</span></h1><p>Rust · Wasm · WebGPU</p></div>'
    const badge = this.element('span', 'badge', 'backend')
    const collapse = this.button('▾', 'collapse', () => this.root.classList.toggle('collapsed'))
    collapse.className = 'collapse'
    collapse.setAttribute('aria-label', 'Collapse panel')
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
    this.sourceLabel = document.createElement('strong')
    this.sourceDetail = document.createElement('span')
    this.sourceDetail.dataset.testid = 'source-detail'
    source.append(this.sourceLabel, this.sourceDetail)

    const preset = createSegmentedControl<PresetId>('Scene', 'preset', [
      { value: 'cat', label: 'Cat' },
      { value: 'teapot', label: 'Teapot' },
      { value: 'knot', label: 'Knot' },
      { value: 'galaxy', label: 'Galaxy' },
    ], settings.preset, handlers.onPreset)
    const animation = createSegmentedControl<AnimationMode>('Motion', 'animation', [
      { value: 'slice', label: 'Sub-slice' },
      { value: 'wave', label: '3D Wave' },
      { value: 'turntable', label: 'Turntable' },
      { value: 'freeze', label: 'Freeze' },
    ], settings.animation, handlers.onAnimation)
    const camera = createSegmentedControl<SceneCameraMode>('Camera', 'camera', [
      { value: 'perspective3d', label: '3D Perspective' },
      { value: 'ortho2d', label: '2D Ortho' },
    ], settings.cameraMode, handlers.onCameraMode)
    const shape = createSegmentedControl<ShapeMode>('Shape', 'shape', [
      { value: 'circle', label: 'SDF Circle' },
      { value: 'quad', label: 'Quad' },
    ], settings.shapeMode, handlers.onShapeMode)
    const particles = createSegmentedControl<ParticleChoice>('Particles', 'count', [
      { value: 'auto', label: 'Auto' },
      { value: '20000', label: '20k' },
      { value: '100000', label: '100k' },
      { value: '250000', label: '250k' },
      { value: '1000000', label: '1M' },
    ], choiceOf(settings.particles), (choice) => {
      this.customParticles.value = ''
      handlers.onParticles(choice === 'auto' ? 'auto' : Number(choice))
    })
    this.customParticles = Object.assign(document.createElement('input'), {
      type: 'number', min: '1', step: '1000', placeholder: 'Custom count (no limit)',
    })
    this.customParticles.className = 'custom-count'
    this.customParticles.dataset.testid = 'count-custom'
    this.customParticles.addEventListener('change', () => {
      const count = Math.floor(Number(this.customParticles.value))
      if (!(count > 0)) return
      particles.set(choiceOf(count))
      handlers.onParticles(count)
    })
    this.controls = {
      set: (s) => {
        preset.set(s.preset)
        animation.set(s.animation)
        camera.set(s.cameraMode)
        shape.set(s.shapeMode)
        particles.set(choiceOf(s.particles))
      },
    }

    const fileInput = Object.assign(document.createElement('input'), {
      type: 'file', accept: '.svg,.obj,image/svg+xml,model/obj', hidden: true,
    })
    fileInput.dataset.testid = 'file-input'
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file) handlers.onUpload(file)
      fileInput.value = ''
    })
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(
      this.button('Upload SVG / OBJ', 'upload-file', () => fileInput.click()),
      this.button('Reset View', 'reset-view', handlers.onResetView),
      fileInput,
    )
    const benchmark = this.button('Run 100k Benchmark', 'run-benchmark', handlers.onRunBenchmark)
    benchmark.classList.add('primary')

    this.status = this.element('p', 'status', 'status')
    const hint = document.createElement('p')
    hint.className = 'hint'
    hint.textContent = 'Drop any .svg or .obj on the page · Drag to orbit · Shift / right-drag to pan · Wheel or pinch to zoom · Click to pick'

    const controls = document.createElement('section')
    controls.className = 'controls'
    controls.append(preset.element, animation.element, camera.element, shape.element, particles.element,
      this.customParticles, actions, benchmark)

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

  /** Names the source, how it was built, and the slice the sub-slice animation writes. */
  setSource(label: string, detail: string, slice: { name: string; start: number; end: number } | null): void {
    this.sourceLabel.textContent = label
    this.sourceDetail.textContent = detail
    this.slice = slice ? { name: slice.name, first: slice.start, last: slice.end - 1 } : null
  }

  setPicked(text: string): void {
    this.values.picked!.textContent = text
  }

  /** A progress or error line; `null` clears it. */
  setStatus(message: string | null, isError = false): void {
    this.status.textContent = message ?? ''
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
    this.uploadList.replaceChildren(...lines.map((line) => {
      const item = document.createElement('li')
      item.textContent = line
      return item
    }))
  }

  private describeUpload({ channel, byteOffset, byteLength }: InstanceUpload): string {
    const first = byteOffset / BYTES_PER_VEC3
    const last = first + byteLength / BYTES_PER_VEC3 - 1
    const isSlice = this.slice !== null && first === this.slice.first && last === this.slice.last
    return `${channel} [${formatCount(first)}…${formatCount(last)}] ${formatBytes(byteLength)}${isSlice ? ` · ${this.slice!.name} slice` : ''}`
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

/** The segmented choice for a request, or `null` for a custom count. */
function choiceOf(request: ParticleRequest): ParticleChoice | null {
  const value = String(request)
  return (PARTICLE_CHOICES as readonly string[]).includes(value) ? (value as ParticleChoice) : null
}
