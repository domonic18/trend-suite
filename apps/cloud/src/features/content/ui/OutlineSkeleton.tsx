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

/**
 * 课程工作区加载骨架（对话流 + 产物工作区双栏形态）：方案页 / 制作台 /
 * 课程入口的加载期共用——加载期就呈现目标页的样子，不闪矮内容页。
 */
export function CourseWorkspaceSkeleton() {
  return (
    <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      <div className="grid content-start gap-4 rounded-xl border border-line bg-bg p-4">
        <Skeleton className="h-[14px] w-[30%]" />
        {[80, 65, 92].map((w, i) => (
          <div className="flex items-start gap-2.5" key={i}>
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-[13px]" style={{ width: `${w}%` }} />
              <Skeleton className="h-[13px]" style={{ width: `${Math.max(30, w - 25)}%` }} />
            </div>
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-[13px] w-[46%]" />
        </div>
      </div>
      <div className="grid content-start gap-3.5 rounded-xl border border-line bg-bg p-4">
        <div className="flex gap-3 border-b border-line pb-2.5">
          {['大纲', '课件', '配图'].map((label) => (
            <Skeleton className="h-[13px] w-10" key={label} />
          ))}
        </div>
        <OutlineSkeleton />
      </div>
    </div>
  )
}
