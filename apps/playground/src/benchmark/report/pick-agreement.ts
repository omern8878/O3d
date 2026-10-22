import type { CompetitorWorkloadResult } from './benchmark-report.types.ts'

/**
 * How often each engine's pick matched O3d's. O3d and the JS baseline test
 * the same bounding spheres; Three.js tests the actual plane triangles, so
 * near edges it can legitimately pick a different (or no) entity.
 */
export function describePickAgreement(results: readonly CompetitorWorkloadResult[]): string {
  const reference = results.find((r) => r.competitor === 'o3d')?.pickedKeys
  if (!reference) return 'No O3d picks to compare against.'
  const parts = results
    .filter((r) => r.competitor !== 'o3d' && r.competitor !== 'o3d-no-culling' && r.pickedKeys)
    .map((r) => {
      const same = r.pickedKeys!.filter((key, i) => key === reference[i]).length
      return `${r.label}: ${same}/${reference.length}`
    })
  const hits = reference.filter((key) => key !== null).length
  return `O3d hit an entity on ${hits}/${reference.length} queries. Same entity as O3d: ${parts.join('; ')}.`
}
