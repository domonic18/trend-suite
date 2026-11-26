import { WorkbenchSkeleton } from '@/features/shell/ConsoleSkeleton'

/**
 * 工作台路由级加载骨架（App Router 流式渲染的 Suspense fallback）：
 * RSC 数据未就绪时主区是骨架而不是空白——侧栏由 layout 流出（logo 常在），
 * 主区由本文件兜住。
 */
export default function WorkbenchLoading() {
  return <WorkbenchSkeleton />
}
