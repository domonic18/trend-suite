import { OpsSkeleton } from '@/features/shell/ConsoleSkeleton'

/**
 * 运营台路由级加载骨架：ops 没有 layout（OpsShell 在各 page 里渲染），
 * loading 期间无壳可依赖，画完整 OpsSkeleton。
 */
export default function OpsLoading() {
  return <OpsSkeleton />
}
