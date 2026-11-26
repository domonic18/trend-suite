import { Skeleton } from '@/components/ui/skeleton'

/**
 * 大纲起草中的骨架屏（Sasan「骨架即预览」）：按 OutlineTree 的最终布局
 * 拼灰条——篇标题 + 两组「章条 + 课条」，行高与树行节奏一致，起草完成
 * 时内容原位长出，不跳版。
 */
export function OutlineSkeleton() {
  return (
    <div className="grid gap-2.5 py-1" aria-busy="true" aria-label="正在生成大纲">
      <Skeleton className="h-[18px] w-[38%]" />
      {[0, 1].map((group) => (
        <div className="grid gap-2 pl-4" key={group}>
          <Skeleton className="h-[15px] w-[52%]" />
          <div className="grid gap-2 pl-4">
            <Skeleton className="h-[13px] w-[74%]" />
            <Skeleton className="h-[13px] w-[66%]" />
            <Skeleton className="h-[13px] w-[70%]" />
          </div>
        </div>
      ))}
      <Skeleton className="h-[15px] w-[46%]" />
      <div className="grid gap-2 pl-4">
        <Skeleton className="h-[13px] w-[68%]" />
        <Skeleton className="h-[13px] w-[58%]" />
      </div>
    </div>
  )
}
