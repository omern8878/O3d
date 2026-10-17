import init, { init_engine } from '@engine/core/pkg/engine.js'
import './style.css'

async function main() {
  await init()
  console.log(init_engine())
}

main().catch((err) => console.error('Failed to initialize engine:', err))
