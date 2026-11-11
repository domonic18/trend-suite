import Fastify from 'fastify'

/** 应用装配：路由注册、错误映射与日志约定都在这里收口。 */
export async function buildApp() {
  const app = Fastify({ logger: true })
  app.get('/health', async () => ({ ok: true }))
  return app
}
