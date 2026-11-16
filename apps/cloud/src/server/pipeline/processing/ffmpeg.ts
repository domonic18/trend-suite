import 'server-only'
import { spawn } from 'node:child_process'
import { getEnv } from '@/env'

/**
 * ffmpeg 调用（arch/05 §3.4）：只 spawn 可执行文件、传参数数组，不经 shell。
 * stderr 只进内部日志，不回客户端。
 */

export class FfmpegError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.name = 'FfmpegError'
    this.stderr = stderr
  }
}

export class FfmpegUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FfmpegUnavailableError'
  }
}

export type RunOptions = {
  args: string[]
  /** 超时（毫秒），默认 PIPELINE_FFMPEG_TIMEOUT_MS。 */
  timeoutMs?: number | undefined
  /** 阶段边界检查：返回 true 时杀掉子进程（取消请求）。 */
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
}

/** 跑一次 ffmpeg，收集 stderr。退出码非 0 抛 FfmpegError。 */
export function runFfmpeg(options: RunOptions): Promise<{ stderr: string }> {
  const env = getEnv()
  const timeoutMs = options.timeoutMs ?? env.PIPELINE_FFMPEG_TIMEOUT_MS
  const bin = env.FFMPEG_PATH

  return new Promise((resolve, reject) => {
    const child = spawn(bin, options.args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(() => reject(new FfmpegError('ffmpeg 执行超时', stderr.slice(-4000))))
    }, timeoutMs)

    const cancelTimer = setInterval(() => {
      void (async () => {
        if (await options.shouldCancel?.()) {
          child.kill('SIGKILL')
          settle(() => reject(new FfmpegError('任务已取消', stderr.slice(-4000))))
        }
      })()
    }, 1_000)

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(cancelTimer)
      fn()
    }

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === 'ENOENT') {
          reject(new FfmpegUnavailableError('ffmpeg 不可用'))
          return
        }
        reject(new FfmpegError(`ffmpeg 调用失败：${err.message}`, stderr.slice(-4000)))
      })
    })

    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve({ stderr })
          return
        }
        reject(new FfmpegError(`ffmpeg 退出码 ${code}`, stderr.slice(-4000)))
      })
    })
  })
}
