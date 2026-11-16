import 'server-only'
import { execFile } from 'node:child_process'
import { getEnv } from '@/env'

/** 抽帧尺寸：ffprobe 只读一次，拿到宽高。 */
export async function probeImageSize(
  path: string,
): Promise<{ width: number; height: number } | null> {
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      getEnv().FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_streams', path],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err)
          return
        }
        resolve(stdout)
      },
    )
  }).catch(() => '')

  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      streams?: Array<{ width?: number; height?: number }>
    }
    const stream = parsed.streams?.[0]
    if (!stream?.width || !stream?.height) return null
    return { width: stream.width, height: stream.height }
  } catch {
    return null
  }
}
