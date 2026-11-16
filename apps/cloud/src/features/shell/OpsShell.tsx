'use client'

import type { ReactNode } from 'react'
import type { SessionUser } from '@trend-suite/contracts'

/** 运营控制台外壳：侧栏 + 顶栏 + 主区（原型 ops-models 的 .ops-app 布局）。 */
export function OpsShell(props: {
  user: SessionUser
  active: string
  onLogout: () => void
  children: ReactNode
}) {
  const initial = props.user.displayName ?? props.user.username
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
        <nav className="ops-menu">
          <div className="ops-g">系统</div>
          <span className="ops-i on">模型配置</span>
          <span className="ops-i off" title="待上线">
            账号管理
          </span>
          <div className="ops-g">交付</div>
          <span className="ops-i off" title="待上线">
            发布交接
          </span>
        </nav>
        <div className="ops-user">
          <span className="ava">{initial.slice(0, 1)}</span>
          <span>
            <span className="un">{initial}</span>
            <br />
            <span className="ur">{props.user.role}</span>
          </span>
          <button type="button" className="out" onClick={props.onLogout}>
            退出
          </button>
        </div>
      </aside>
      <div>
        <header className="ops-top">
          <span>运营控制台</span>
          <span className="sep">/</span>
          <b>{props.active}</b>
          <span className="right">
            <span>密钥 AES-GCM 加密 · 明文不回显</span>
          </span>
        </header>
        <main className="ops-main">{props.children}</main>
      </div>
    </div>
  )
}
