'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { SessionUser } from '@trend-suite/contracts'
import { Button } from '@/components/ui/button'
import { useWorkbenchTheme } from './ThemeToggle'
import { BuildInfo } from './BuildInfo'

const MENU: { label: string; href: string | null }[] = [
  { label: '运营配置', href: '/ops' },
  { label: '账号管理', href: null },
]

/** 运营控制台外壳：侧栏 + 顶栏 + 主区（原型 ops-models 的 .ops-app 布局）。 */
export function OpsShell(props: {
  user: SessionUser
  active: string
  onLogout: () => void
  children: ReactNode
}) {
  const initial = props.user.displayName ?? props.user.username
  useWorkbenchTheme()
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
          {MENU.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className={item.label === props.active ? 'ops-i on' : 'ops-i'}
              >
                {item.label}
              </Link>
            ) : (
              <span key={item.label} className="ops-i off" title="待上线">
                {item.label}
              </span>
            ),
          )}
          <div className="ops-g">交付</div>
          <span className="ops-i off" title="待上线">
            发布交接
          </span>
        </nav>
        <div className="ops-user">
          <span className="ava">{initial.slice(0, 1)}</span>
          <span className="ops-user-id">
            <span className="un">{initial}</span>
            <span className="ur">{props.user.role}</span>
          </span>
          <a className="bk" href="/workbench">
            返回工作台
          </a>
          <Button variant="ghost" size="sm" onClick={props.onLogout}>
            退出
          </Button>
        </div>
        <BuildInfo />
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
