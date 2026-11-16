/**
 * 加工 worker 进程入口（arch/02 §7）：同一个镜像，靠 APP_ROLE=worker 区分。
 *
 * 启动方式：
 *   node --conditions=react-server --import tsx src/worker.ts
 *
 * `--conditions=react-server` 是必需的：服务端代码用 'server-only' 标记，
 * 裸 node 进程不解析该条件会直接抛「不能从客户端组件导入」。
 */
import { startWorker } from '@/server/pipeline/jobs/worker'

const role = process.env.APP_ROLE ?? 'web'
if (role !== 'worker') {
  console.error(`[worker] APP_ROLE=${role}，本进程只跑 worker（请设 APP_ROLE=worker）`)
  process.exit(1)
}

await startWorker()
