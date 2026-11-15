import 'server-only'
import { execFile } from 'node:child_process'
import { getEnv } from '@/env'

/**
 * 媒体校验（arch/05 §3.3）：ffprobe 只读探测，不解码不转码。
 * 只 spawn 可执行文件、传参数数组，不经 shell。
 */

export class ProbeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeUnavailableError'
  }
}

export type ProbeResult = {
  videoOk: boolean
  audioOk: boolean
  durationS: number | null
}

type FfprobeOutput = {
  streams?: Array<{ codec_type?: string }>
  format?: { duration?: string }
}

export async function probeMedia(path: string): Promise<ProbeResult> {
  const { FFPROBE_PATH } = getEnv()
  const raw = await runProbe(FFPROBE_PATH, path)
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(raw) as FfprobeOutput
  } catch {
    throw new ProbeUnavailableError('媒体探测结果无法解析')
  }
  const streams = parsed.streams ?? []
  const duration = Number(parsed.format?.duration)
  return {
    videoOk: streams.some((s) => s.codec_type === 'video'),
    audioOk: streams.some((s) => s.codec_type === 'audio'),
    durationS: Number.isFinite(duration) && duration > 0 ? duration : null,
  }
}

function runProbe(bin: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') {
            reject(new ProbeUnavailableError('ffprobe 不可用'))
            return
          }
          // ffprobe 对损坏媒体也会以非零码退出，但 stdout 仍有内容——
          // 交给上层按「探测不出流」处理，这里只把可读信息带出去。
          if (!stdout) {
            reject(new ProbeUnavailableError('媒体探测失败'))
            return
          }
          resolve(stdout)
          return
        }
        resolve(stdout)
      },
    )
  })
}
