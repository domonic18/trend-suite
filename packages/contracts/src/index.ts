import { z } from 'zod'

/** 跨端契约单一真相源：后端与两个插件共享的 schema 只在这里定义。 */
export const healthResponse = z.object({ ok: z.literal(true) })
