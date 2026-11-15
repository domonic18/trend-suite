import { z } from 'zod'

/**
 * 环境变量校验与出口（arch/01 §4.3）：全应用唯一读取点。
 * 惰性校验——`next build` 会加载路由模块，构建期不该因缺 DATABASE_URL 而失败。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 未设置'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3940),
})

export type AppEnv = z.infer<typeof envSchema>

let cached: AppEnv | undefined

export function getEnv(): AppEnv {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue?.path.join('.') ?? 'env'
      throw new Error(`环境变量不合法（${where}）：${issue?.message ?? '未知'}`)
    }
    cached = parsed.data
  }
  return cached
}
