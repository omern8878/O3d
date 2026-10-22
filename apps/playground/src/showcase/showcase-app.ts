import { BenchmarkSuite, GpuContext, type SceneCameraMode, type ShapeMode } from '@engine/templates'
import { BenchmarkPanel } from '../ui/benchmark-panel.ts'
import { Hud, type HudSettings, type ParticleCount } from '../ui/hud.ts'
import { CAT_LAYER_LABELS, CAT_SVG, CAT_TAIL_LAYER, CAT_TAIL_PIVOT } from '../vector/cat-vector-svg.ts'
import type { PointLayer, SvgPointCloud } from '../vector/point-cloud.types.ts'
import { sampleSvgPointCloud } from '../vector/svg-point-sampler.ts'
import { CameraRig } from './camera-rig.ts'
import { FrameTelemetry } from './frame-telemetry.ts'
import { PickPulse } from './pick-pulse.ts'
import { PointerControls } from './pointer-controls.ts'
import { createRenderBackend, type RenderBackend } from './render-backend.ts'
import { ShowcaseScene } from './showcase-scene.ts'
import { TailAnimator } from './tail-animator.ts'

const BENCHMARK_ENTITIES = 100_000
const BUILT_IN_LABEL = 'Vector cat (built-in)'

type SvgSource = { markup: string; label: string; builtIn: boolean }

/**
 * The live vector-cat showcase: samples an SVG into particles, renders them
 * through `SceneTemplate`, animates the tail slice, handles picking and the
 * HUD, and runs the benchmark on demand.
 */
export class ShowcaseApp {
  private readonly canvas: HTMLCanvasElement
  private readonly backend: RenderBackend
  private readonly hud: Hud
  private readonly benchmarkPanel: BenchmarkPanel
  private readonly rig = new CameraRig()
  private readonly pulse = new PickPulse()
  private readonly telemetry = new FrameTelemetry()
  private readonly settings: HudSettings = {
    cameraMode: 'perspective3d',
    shapeMode: 'circle',
    count: 50_000,
    animateTail: true,
  }
  private source: SvgSource = { markup: CAT_SVG, label: BUILT_IN_LABEL, builtIn: true }
  private current!: ShowcaseScene
  private tail: TailAnimator | null = null
  private viewport = { width: 0, height: 0 }
  private benchmarkContext: Promise<GpuContext | undefined> | null = null
  private benchmarkRunning = false

  /** Builds the page inside `root` and starts the render loop. */
  static async start(root: HTMLElement): Promise<ShowcaseApp> {
    const canvas = document.createElement('canvas')
    canvas.id = 'render-canvas'
    canvas.dataset.testid = 'render-canvas'
    root.append(canvas)
    const backend = await createRenderBackend(canvas)
    return new ShowcaseApp(root, canvas, backend)
  }

  private constructor(root: HTMLElement, canvas: HTMLCanvasElement, backend: RenderBackend) {
    this.canvas = canvas
    this.backend = backend
    this.hud = new Hud(root, this.settings, {
      onCameraMode: (mode) => this.setCameraMode(mode),
      onShapeMode: (mode) => this.setShapeMode(mode),
      onParticleCount: (count) => this.setParticleCount(count),
      onAnimateTail: (animate) => (this.settings.animateTail = animate),
      onUploadSvg: (file) => void this.loadSvgFile(file),
      onRestoreCat: () => this.loadSource({ markup: CAT_SVG, label: BUILT_IN_LABEL, builtIn: true }),
      onResetView: () => this.resetView(),
      onRunBenchmark: () => void this.runBenchmark(),
    })
    this.hud.setBackend(backend.kind, backend.detail)
    this.benchmarkPanel = new BenchmarkPanel(root)
    new PointerControls(canvas, () => this.current.scene, {
      onTap: (x, y) => this.pick(x, y),
      onCameraInteraction: () => this.rig.stopSway(),
    })

    this.rebuild(this.sample(this.source))
    document.body.dataset.ready = 'true'
    requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number) => {
    const started = performance.now()
    const { scene, ids, cloud } = this.current

    const size = this.backend.resize()
    if (size.width !== this.viewport.width || size.height !== this.viewport.height) {
      this.viewport = size
      scene.getCameraController().resize(size.width, size.height)
    }
    this.rig.update(scene, now / 1000)
    if (this.tail && this.settings.animateTail) this.tail.update(scene, ids, now / 1000)
    this.pulse.update(scene, ids, cloud, now)

    scene.renderFrame()
    this.backend.present(scene)

    this.telemetry.record(now, performance.now() - started)
    this.hud.update(now, {
      fps: this.telemetry.fps,
      frameMs: this.telemetry.frameMs,
      stats: scene.getFrameStats(),
    })
    requestAnimationFrame(this.frame)
  }

  private sample(source: SvgSource): SvgPointCloud {
    return sampleSvgPointCloud(source.markup, { count: this.settings.count })
  }

  /** Replaces the scene with a fresh one built from `cloud`. */
  private rebuild(cloud: SvgPointCloud): void {
    this.current?.destroy()
    this.pulse.cancel()
    this.current = new ShowcaseScene(
      this.backend.gpuContext,
      cloud,
      this.settings.cameraMode,
      this.settings.shapeMode,
    )
    this.viewport = { width: 0, height: 0 }
    this.rig.apply(this.current.scene, this.settings.cameraMode)

    const tailLayer = cloud.layers.find((layer) => layer.name.toLowerCase().includes(CAT_TAIL_LAYER))
    this.tail = tailLayer ? new TailAnimator(cloud, tailLayer, this.tailPivot(cloud, tailLayer)) : null
    this.hud.setSource(
      `${this.source.label}${this.tail ? '' : ' · no "tail" layer to animate'}`,
      this.source.builtIn,
      tailLayer ? [tailLayer.start, tailLayer.end] : null,
    )
    this.hud.setPicked('—')
  }

  /** The cat sways from its hip; other SVGs' tails sway around their centroid. */
  private tailPivot(cloud: SvgPointCloud, layer: PointLayer): [number, number] {
    if (this.source.builtIn) return cloud.toWorld(CAT_TAIL_PIVOT.x, CAT_TAIL_PIVOT.y)
    let x = 0, y = 0
    for (let i = layer.start; i < layer.end; i++) {
      x += cloud.positions[i * 3]!
      y += cloud.positions[i * 3 + 1]!
    }
    const n = Math.max(layer.end - layer.start, 1)
    return [x / n, y / n]
  }

  private loadSource(source: SvgSource): void {
    try {
      const cloud = sampleSvgPointCloud(source.markup, { count: this.settings.count })
      this.source = source
      this.rebuild(cloud)
      this.hud.setStatus(source.builtIn ? '' : `Loaded ${source.label}: ${cloud.layers.length} layers.`)
    } catch (error) {
      this.hud.setStatus(`Could not use that SVG: ${error instanceof Error ? error.message : error}`, true)
    }
  }

  private async loadSvgFile(file: File): Promise<void> {
    this.loadSource({ markup: await file.text(), label: file.name, builtIn: false })
  }

  private setCameraMode(mode: SceneCameraMode): void {
    this.settings.cameraMode = mode
    this.rig.resumeSway()
    this.rig.apply(this.current.scene, mode)
  }

  private setShapeMode(mode: ShapeMode): void {
    this.settings.shapeMode = mode
    this.current.scene.setShapeMode(mode)
  }

  private setParticleCount(count: ParticleCount): void {
    this.settings.count = count
    this.rebuild(this.sample(this.source))
  }

  private resetView(): void {
    this.rig.resumeSway()
    this.rig.apply(this.current.scene, this.settings.cameraMode)
  }

  private pick(clientX: number, clientY: number): void {
    const id = this.current.scene.pickNodeAtScreen(clientX, clientY, this.canvas.getBoundingClientRect())
    if (id === null) {
      this.hud.setPicked('— (empty space)')
      return
    }
    const layer = this.current.layerOf(id)
    const label = layer ? CAT_LAYER_LABELS[layer.name] ?? layer.name : 'unknown'
    this.hud.setPicked(`#${id} · ${label}`)
    if (layer) this.pulse.start(layer, performance.now())
  }

  private async runBenchmark(): Promise<void> {
    if (this.benchmarkRunning) return
    this.benchmarkRunning = true
    this.benchmarkPanel.showRunning(BENCHMARK_ENTITIES)
    try {
      const gpuContext = await this.benchmarkGpuContext()
      const report = await new BenchmarkSuite(gpuContext).run(
        { entityCount: BENCHMARK_ENTITIES },
        (completed) => this.benchmarkPanel.showRunning(BENCHMARK_ENTITIES, completed),
      )
      this.benchmarkPanel.showReport(report)
      console.info('O3d benchmark report', report)
    } catch (error) {
      this.benchmarkPanel.showError(`Benchmark failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      this.benchmarkRunning = false
    }
  }

  /**
   * A separate offscreen WebGPU context so benchmark frames include real
   * upload costs without flashing on screen; headless without WebGPU.
   */
  private benchmarkGpuContext(): Promise<GpuContext | undefined> {
    this.benchmarkContext ??= this.backend.kind === 'webgpu'
      ? GpuContext.create({ canvas: Object.assign(document.createElement('canvas'), { width: 64, height: 64 }) })
          .catch(() => undefined)
      : Promise.resolve(undefined)
    return this.benchmarkContext
  }
}
