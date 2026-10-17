import { EntityManager } from '@engine/templates'
import { assertFloatsEqual } from './assertions.ts'

const INITIAL_CAPACITY = 2

/**
 * End-to-end check of the zero-copy ECS bridge: contiguous writes, dynamic
 * Wasm heap growth, swap-and-pop compaction and sparse-index resolution.
 *
 * Throws on the first failed assertion.
 */
export function runMemoryDiagnostics(): void {
  const manager = new EntityManager(INITIAL_CAPACITY)
  const positions = () => Array.from(manager.getRawViews().positions)

  console.log(`Initial capacity: ${manager.getCapacity()}`)

  // Step A: allocation and zero-copy writes. Entity C overflows the initial capacity.
  const entityA = manager.createEntity({
    position: { x: 10, y: 20, z: 30 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#ff0000',
  })
  manager.createEntity({
    position: { x: 40, y: 50, z: 60 },
    scale: { x: 2, y: 2, z: 2 },
    color: '#00ff00',
  })
  const entityC = manager.createEntity({
    position: { x: 70, y: 80, z: 90 },
    scale: { x: 3, y: 3, z: 3 },
    color: '#0000ff',
  })

  console.log('--- Step A: allocation, zero-copy write, capacity growth ---')
  console.log(`active=${manager.getActiveCount()} capacity=${manager.getCapacity()}`)
  console.log('positions:', positions())
  assertFloatsEqual('Step A', positions(), [10, 20, 30, 40, 50, 60, 70, 80, 90])
  if (manager.getCapacity() <= INITIAL_CAPACITY) {
    throw new Error('Step A failed: capacity did not grow')
  }

  // Step B: removing the first entity moves the last one into its slot.
  manager.removeEntity(entityA)

  console.log('--- Step B: swap-and-pop after removing Entity A ---')
  console.log(`active=${manager.getActiveCount()} capacity=${manager.getCapacity()}`)
  console.log('positions:', positions())
  assertFloatsEqual('Step B', positions(), [70, 80, 90, 40, 50, 60])

  // Step C: the sparse set must resolve Entity C to its new dense slot.
  manager.updateEntity(entityC, { position: { x: 999 } })

  console.log('--- Step C: sparse index resolution after swap ---')
  console.log('positions:', positions())
  assertFloatsEqual('Step C', positions(), [999, 80, 90, 40, 50, 60])

  console.log('All memory diagnostics passed.')
}
