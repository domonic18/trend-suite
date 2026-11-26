'use client'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * 载入骨架：会话校验期间占位。
 *
 * 以前是整页换成一行「正在校验登录状态…」，切页时闪一下；
 * 现在换成「壳还在、内容区是骨架」——布局不动，只有内容在长出来。
 */

/** 工作台骨架：与 WorkbenchShell 同构（侧栏导航/顶栏面包屑与控件都有占位），
 * 刷新时从骨架到真实壳视觉连续，不产生「换了个中间页」的感觉。 */
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
        <nav className="ops-menu">
          <div className="ops-g">工作台</div>
          <div className="ops-i">
            <span className="oi-ico" aria-hidden="true" />
            <span className="oi-t" aria-hidden="true" />
          </div>
          <div className="ops-i">
            <span className="oi-ico" aria-hidden="true" />
            <span className="oi-t" aria-hidden="true" />
          </div>
        </nav>
        <div className="sbc-btn" aria-hidden="true">
          <span className="sb-dot dot-idle" />
          <span className="sbc-t">
            <b className="w-[60%]" />
            <small />
          </span>
        </div>
      </aside>
      <div className="wb-col">
        <header className="ops-top">
          <nav className="ops-crumb" aria-hidden="true">
            <span className="crumb-sk" />
            <i className="sep" />
            <span className="crumb-sk w-[120px]" />
          </nav>
          <div className="ops-corner">
            <span className="corner-dot" aria-hidden="true" />
            <span className="corner-ava" aria-hidden="true" />
          </div>
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

/**
 * 主区内容骨架（无壳）：路由级 loading.tsx 用。
 * 流式加载期间 layout 的壳（侧栏/顶栏）已经流出——loading 只画主区，
 * 再画完整壳会叠加出双壳中间页。
 */
export function ContentSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <main className="ops-main" aria-busy="true">
      <div className="skeleton-page">
        <Skeleton className="h-[22px] w-[32%]" />
        <Skeleton className="h-[14px] w-[56%]" />
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton className="h-[78px]" key={index} />
        ))}
      </div>
    </main>
  )
}
