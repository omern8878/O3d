import type { SceneCameraMode, ShapeMode } from '@engine/templates'
import type { ParticleRequest } from '../cloud/point-cloud.types.ts'
import type { SceneSource } from '../import/scene-source.types.ts'
import { sourceFromFile } from '../import/source-from-file.ts'
import { createPresets, type PresetId } from '../presets/preset-catalog.ts'
import { rasterizeSvg } from '../raster/svg-rasterizer.ts'
import { CompetitorBenchmarkPanel } from '../ui/competitor-benchmark-panel.ts'
import { DropOverlay } from '../ui/drop-overlay.ts'
import { formatCount } from '../ui/format.ts'
import { Hud, type AnimationMode, type HudSettings } from '../ui/hud.ts'
import { MorphTransition } from './animation/morph-transition.ts'
import { SliceAnimator } from './animation/slice-animator.ts'
import { WaveAnimator } from './animation/wave-animator.ts'
import { CameraRig, DEFAULT_3D_ANGLES, MODEL_3D_ANGLES } from './camera-rig.ts'
import { FrameTelemetry } from './frame-telemetry.ts'
import { PickPulse } from './pick-pulse.ts'
import { PointerControls } from './pointer-controls.ts'
import { createRenderBackend, type RenderBackend } from './render-backend.ts'
import { ShowcaseScene } from './showcase-scene.ts'

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * The particle showcase: builds any source (presets, dropped or uploaded SVG
 * / OBJ files) into a `SceneTemplate`, morphs between scenes, runs the
 * animation modes, handles picking and the HUD, and runs the benchmark on
 * demand.
 */
export class ShowcaseApp {
  private readonly canvas: HTMLCanvasElement
  private readonly backend: RenderBackend
  private readonly hud: Hud
  private readonly benchmarkPanel: CompetitorBenchmarkPanel
  private readonly presets = createPresets(rasterizeSvg)
  private readonly rig = new CameraRig()
  private readonly pulse = new PickPulse()
  private readonly telemetry = new FrameTelemetry()
  private readonly settings: HudSettings = {
    preset: 'cat',
    cameraMode: 'perspective3d',
    shapeMode: 'circle',
    particles: 'auto',
    animation: 'slice',
  }
  private source: SceneSource
  private current: ShowcaseScene | null = null
  private slice: SliceAnimator | null = null
  private wave: WaveAnimator | null = null
  private morph: MorphTransition | null = null
  private viewport = { width: 0, height: 0 }
  private loadGeneration = 0
  private lastFrameAt = 0
  private benchmarkRunning = false

  /** Builds the page inside `root`, loads the first scene and starts rendering. */
  static async start(root: HTMLElement): Promise<ShowcaseApp> {
    const canvas = document.createElement('canvas')
    canvas.id = 'render-canvas'
    canvas.dataset.testid = 'render-canvas'
    root.append(canvas)
    const app = new ShowcaseApp(root, canvas, await createRenderBackend(canvas))
    await app.load(app.source)
    document.body.dataset.ready = 'true'
    requestAnimationFrame(app.frame)
    return app
  }

  private constructor(root: HTMLElement, canvas: HTMLCanvasElement, backend: RenderBackend) {
    this.canvas = canvas
    this.backend = backend
    this.source = this.presets.cat
    this.hud = new Hud(root, this.settings, {
      onPreset: (id) => void this.loadPreset(id),
      onCameraMode: (mode) => this.setCameraMode(mode),
      onShapeMode: (mode) => this.setShapeMode(mode),
      onParticles: (request) => void this.setParticles(request),
      onAnimation: (mode) => this.setAnimation(mode),
      onUpload: (file) => void this.loadFile(file),
      onResetView: () => this.resetView(),
      onRunBenchmark: () => void this.runBenchmark(),
    })
    this.hud.setBackend(backend.kind, backend.detail)
    this.benchmarkPanel = new CompetitorBenchmarkPanel(root)
    new DropOverlay(root, (file) => void this.loadFile(file))
    new PointerControls(canvas, () => this.current!.scene, {
      onTap: (x, y) => this.pick(x, y),
      onCameraInteraction: () => this.rig.stopSway(),
    })
  }

  private readonly frame = (now: number) => {
    const current = this.current
    if (!current) {
      requestAnimationFrame(this.frame)
      return
    }
    const started = performance.now()
    const { scene } = current
    const deltaSeconds = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.1) : 0
    this.lastFrameAt = now

    const size = this.backend.resize()
    if (size.width !== this.viewport.width || size.height !== this.viewport.height) {
      this.viewport = size
      scene.getCameraController().resize(size.width, size.height)
    }
    if (this.settings.animation === 'turntable') this.rig.turntable(scene, deltaSeconds, current.boundingRadius)
    else this.rig.update(scene, now / 1000)

    if (this.morph) {
      if (this.morph.step(scene, now)) this.morph = null
    } else {
      if (this.settings.animation === 'slice') this.slice?.update(scene, now / 1000)
      if (this.settings.animation === 'wave') this.waveAnimator().update(scene, now / 1000)
      this.pulse.update(scene, current.cloud, now)
    }

    scene.renderFrame()
    this.backend.present(scene)
    this.telemetry.record(now, performance.now() - started)
    this.hud.update(now, { fps: this.telemetry.fps, frameMs: this.telemetry.frameMs, stats: scene.getFrameStats() })
    requestAnimationFrame(this.frame)
  }

  /**
   * Builds `source` at the current particle setting and swaps it in, morphing
   * from whatever was on screen. A newer load supersedes an older one still
   * building, so rapid clicks never show a stale scene.
   */
  private async load(source: SceneSource): Promise<void> {
    const generation = ++this.loadGeneration
    document.body.dataset.loading = 'true'
    const request = this.settings.particles
    this.hud.setStatus(`Building ${source.label} (${request === 'auto' ? 'auto' : formatCount(request)} particles)…`)
    await nextFrame()
    try {
      const built = await source.build(request)
      if (generation !== this.loadGeneration) return

      const snapshot = this.current?.snapshot() ?? null
      this.current?.destroy()
      this.pulse.cancel()
      this.wave = null
      if (source.dimension === '3d') this.settings.cameraMode = 'perspective3d'
      const current = new ShowcaseScene(this.backend.gpuContext, built, this.settings.cameraMode, this.settings.shapeMode)
      this.current = current
      this.source = source
      this.settings.preset = source.builtIn ? (source.id as PresetId) : null
      this.viewport = { width: 0, height: 0 }
      this.rig.resumeSway()
      this.rig.apply(current.scene, this.settings.cameraMode, this.viewAngles(), current.boundingRadius)

      const sliceLayer = built.slice ? built.cloud.layers.find((l) => l.name === built.slice!.layer) : undefined
      this.slice = sliceLayer && built.slice ? new SliceAnimator(built.cloud, sliceLayer, built.slice) : null
      this.morph = snapshot ? new MorphTransition(snapshot, built.cloud) : null
      this.morph?.begin(current.scene, performance.now())

      this.hud.setSettings(this.settings)
      this.hud.setSource(
        source.label,
        `${formatCount(built.cloud.count)} particles · ${built.detail}`,
        sliceLayer ? { name: sliceLayer.name, start: sliceLayer.start, end: sliceLayer.end } : null,
      )
      this.hud.setPicked('—')
      this.hud.setStatus(this.settings.animation === 'slice' && !this.slice ? 'This scene has no separate layer to animate.' : null)
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.hud.setStatus(`Could not load ${source.label}: ${error instanceof Error ? error.message : error}`, true)
      }
    } finally {
      if (generation === this.loadGeneration) delete document.body.dataset.loading
    }
  }

  private loadPreset(id: PresetId): Promise<void> {
    return this.load(this.presets[id])
  }

  private async loadFile(file: File): Promise<void> {
    try {
      await this.load(sourceFromFile(file.name, await file.text(), rasterizeSvg))
    } catch (error) {
      this.hud.setStatus(`Could not import ${file.name}: ${error instanceof Error ? error.message : error}`, true)
    }
  }

  private setParticles(request: ParticleRequest): Promise<void> {
    this.settings.particles = request
    return this.load(this.source)
  }

  private setAnimation(mode: AnimationMode): void {
    const scene = this.current?.scene
    if (scene && !this.morph) {
      // Put moved particles back at rest before the next mode takes over.
      if (this.settings.animation === 'slice') this.slice?.reset(scene)
      if (this.settings.animation === 'wave') this.wave?.reset(scene)
    }
    this.settings.animation = mode
    if (mode === 'turntable' && this.settings.cameraMode === 'ortho2d') this.setCameraMode('perspective3d')
    this.hud.setStatus(mode === 'slice' && !this.slice ? 'This scene has no separate layer to animate.' : null)
    this.hud.setSettings(this.settings)
  }

  /** 3D sources open at an angle that shows their depth; 2D ones face the camera. */
  private viewAngles() {
    return this.source.dimension === '3d' ? MODEL_3D_ANGLES : DEFAULT_3D_ANGLES
  }

  private waveAnimator(): WaveAnimator {
    this.wave ??= new WaveAnimator(this.current!.cloud)
    return this.wave
  }

  private setCameraMode(mode: SceneCameraMode): void {
    this.settings.cameraMode = mode
    this.rig.resumeSway()
    if (this.current) this.rig.apply(this.current.scene, mode, this.viewAngles(), this.current.boundingRadius)
    this.hud.setSettings(this.settings)
  }

  private setShapeMode(mode: ShapeMode): void {
    this.settings.shapeMode = mode
    this.current?.scene.setShapeMode(mode)
  }

  private resetView(): void {
    this.setCameraMode(this.settings.cameraMode)
  }

  private pick(clientX: number, clientY: number): void {
    const current = this.current
    if (!current || this.morph) return
    const id = current.scene.pickNodeAtScreen(clientX, clientY, this.canvas.getBoundingClientRect())
    if (id === null) {
      this.hud.setPicked('— (empty space)')
      return
    }
    const layer = current.layerOf(id)
    const label = layer ? current.built.labels[layer.name] ?? layer.name : 'unknown'
    this.hud.setPicked(`#${id} · ${label}`)
    if (layer) this.pulse.start(layer, performance.now())
  }

  /**
   * Runs the competitor benchmark (O3d vs. Three.js vs. a JS scene graph).
   * The suite and Three.js load on demand, keeping them out of the showcase
   * bundle. The report is also left on `window.__o3dBenchmarkReport`.
   */
  private async runBenchmark(): Promise<void> {
    if (this.benchmarkRunning) return
    this.benchmarkRunning = true
    this.benchmarkPanel.showProgress(0, 'Loading benchmark…')
    try {
      const { runCompetitorBenchmark, benchmarkOptionsFromUrl } = await import('../benchmark/run-competitor-benchmark.ts')
      const report = await runCompetitorBenchmark(
        this.backend.kind === 'webgpu',
        benchmarkOptionsFromUrl(location.search),
        ({ fraction, message }) => this.benchmarkPanel.showProgress(fraction, message),
      )
      ;(window as { __o3dBenchmarkReport?: unknown }).__o3dBenchmarkReport = report
      this.benchmarkPanel.showReport(report)
    } catch (error) {
      console.error(error)
      this.benchmarkPanel.showError(`Benchmark failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      this.benchmarkRunning = false
    }
  }
}
