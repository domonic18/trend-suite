import { ContentSkeleton } from '@/features/shell/ConsoleSkeleton'

/**
 * 工作台路由级加载骨架（App Router 流式渲染的 Suspense fallback）：
 * RSC 数据未就绪时主区是骨架而不是空白。只画主区（ContentSkeleton）——
 * 壳（侧栏/顶栏）由 workbench/layout 流出，loading 再画壳会叠加双壳。
 */
export default function WorkbenchLoading() {
  return <ContentSkeleton />
}
