import init from '@engine/core/pkg/engine.js'
import { runMemoryDiagnostics } from './diagnostics/memory-suite.ts'
import './style.css'

async function main() {
  await init()
  runMemoryDiagnostics()
}

main().catch((err) => console.error('Playground failed:', err))
