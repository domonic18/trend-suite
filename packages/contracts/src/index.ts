import { z } from 'zod'

/** 跨端契约单一真相源：后端与两个插件共享的 schema 只在这里定义。 */
export * from './ids.js'
export * from './enums.js'
export * from './errors.js'
export * from './auth.js'
export * from './accounts.js'
export * from './courses.js'
export * from './media-assets.js'
export * from './media-processing.js'
export * from './models.js'

export const healthResponse = z.object({ ok: z.literal(true) })
