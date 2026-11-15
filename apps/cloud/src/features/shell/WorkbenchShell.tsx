'use client'

import type { ReactNode } from 'react'
import type { SessionUser } from '@trend-suite/contracts'

/** 工作台外壳：顶栏 + 面包屑 + 内容区。课程列表页与原始数据页共用。 */
export function WorkbenchShell(props: {
  user: SessionUser
  nav?: ReactNode
  crumb: ReactNode
  onLogout: () => void
  children: ReactNode
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="mk">趋</span>
            趋势课程
            <small>生产工作台</small>
          </div>
          {props.nav ? <nav className="topnav">{props.nav}</nav> : null}
          <div className="topbar-right">
            <span>
              {props.user.displayName ?? props.user.username} · {props.user.role}
            </span>
            <button type="button" className="btn link" onClick={props.onLogout}>
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="wrap">
        <div className="crumb">{props.crumb}</div>
        {props.children}
      </main>
    </>
  )
}
