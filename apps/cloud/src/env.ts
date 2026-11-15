import { z } from 'zod'

/**
 * 环境变量校验与出口（arch/01 §4.3）：全应用唯一读取点。
 * 惰性校验——`next build` 会加载路由模块，构建期不该因缺 DATABASE_URL 而失败。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 未设置'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3940),
  // 媒体存储（arch/05 §3.2）：生产定案 cos，local 仅开发测试。
  MEDIA_STORAGE: z.enum(['local', 'cos']).default('local'),
  MEDIA_LOCAL_DIR: z.string().min(1).optional(),
  // 直传凭据签名密钥：绑定素材 + 字节数 + 摘要 + 有效期（arch/05 §3.1）。
  MEDIA_UPLOAD_SECRET: z.string().min(16, 'MEDIA_UPLOAD_SECRET 至少 16 个字符').optional(),
  PIPELINE_MAX_SOURCE_SECONDS: z.coerce.number().int().positive().default(14400),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  // COS 骨架：桶与凭据到位前不启用。
  COS_BUCKET: z.string().min(1).optional(),
  COS_REGION: z.string().min(1).optional(),
  COS_ENDPOINT: z.string().min(1).optional(),
  COS_SECRET_ID: z.string().min(1).optional(),
  COS_SECRET_KEY: z.string().min(1).optional(),
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
