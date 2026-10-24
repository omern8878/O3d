import type { SceneTemplate } from '@engine/templates'

/** The one scene capability animations need: bulk writes by view index. */
export type NodeWriter = Pick<SceneTemplate, 'writeNodeViews'>
