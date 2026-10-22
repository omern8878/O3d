import init from '@engine/core/pkg/engine.js'
import { runMemoryDiagnostics } from './diagnostics/memory-suite.ts'
import { ShowcaseApp } from './showcase/showcase-app.ts'
import './style.css'

async function main() {
  await init()
  if (new URLSearchParams(location.search).has('diagnostics')) runMemoryDiagnostics()
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('The playground needs a <div id="app">.')
  await ShowcaseApp.start(root)
}

main().catch((err) => {
  console.error('Playground failed:', err)
  document.body.dataset.error = String(err)
})
