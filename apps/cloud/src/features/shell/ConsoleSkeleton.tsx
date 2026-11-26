'use client'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * 载入骨架：会话校验期间占位。
 *
 * 以前是整页换成一行「正在校验登录状态…」，切页时闪一下；
 * 现在换成「壳还在、内容区是骨架」——布局不动，只有内容在长出来。
 */

/** 工作台骨架：侧栏 + 内容区，形状与 WorkbenchShell 一致。 */
export function WorkbenchSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ops-app">
      <aside className="ops-sb">
        <div className="ops-brand">
          <span className="mk">趋</span>
          <span>
            <b>趋势课程</b>
            <small>生产工作台</small>
          </span>
        </div>
      </aside>
      <div className="wb-col">
        <header className="ops-top">
          <span>生产工作台</span>
        </header>
        <main className="ops-main" aria-busy="true" aria-live="polite">
          <div className="skeleton-page">
            <Skeleton className="h-[22px] w-[32%]" />
            <Skeleton className="h-[14px] w-[56%]" />
            {Array.from({ length: rows }, (_, index) => (
              <Skeleton className="h-[78px]" key={index} />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

/** 运营控制台的载入骨架（没有用户信息时也能画）。 */
export function OpsSkeleton() {
  return (
    <div className="ops-app">
      <aside className="ops-sb">
        <div className="ops-brand">
          <span className="mk">趋</span>
          <span>
            <b>趋势课程</b>
            <small>运营控制台</small>
          </span>
        </div>
      </aside>
      <div>
        <header className="ops-top">
          <span>运营控制台</span>
        </header>
        <main className="ops-main" aria-busy="true">
          <div className="skeleton-page">
            <Skeleton className="h-[22px] w-[32%]" />
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton className="h-[78px]" key={index} />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
