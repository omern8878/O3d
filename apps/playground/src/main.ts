import init from '@engine/core/pkg/engine.js'
import { runMemoryDiagnostics } from './diagnostics/memory-suite.ts'
import { runRenderSceneDemo } from './demos/render-scene-demo.ts'
import './style.css'

async function main() {
  await init()
  runMemoryDiagnostics()
  await runRenderSceneDemo()
}

main().catch((err) => console.error('Playground failed:', err))
