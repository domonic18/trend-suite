'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, type ReactNode } from 'react'
import { routes } from '@/lib/routes'
import { useSession } from '@/features/accounts/SessionProvider'
import { BuildInfo } from './BuildInfo'
import { ThemeIconButton, UserMenu, useWorkbenchTheme } from './ThemeToggle'

/**
 * 控制台统一壳（评审 #5）：工作台与运营台此前各写一套侧栏/顶栏/用户区
 * （三个用户菜单实现）。这里只画结构，两个壳退化为配置——
 * 侧栏 = 品牌 + nav 槽 + 侧栏附加槽 + 版本行；顶栏 = 面包屑槽 + 主题钮 + 用户菜单。
 * 主题跟随工作台（console 全区同一 data-wb-theme，门户/登录保持浅色）。
 */

export type ShellNavItem = {
  key: string
  label: string
  href: string
  icon?: ReactNode
  active?: boolean
}

/** 侧栏导航项（ops-i）；icon 可选。 */
export function ShellNav({ items, group }: { items: ShellNavItem[]; group?: string }) {
  return (
    <>
      {group ? <div className="ops-g">{group}</div> : null}
      {items.map((item) => (
        <Link key={item.key} className={`ops-i ${item.active ? 'on' : ''}`} href={item.href}>
          {item.icon ? <svg viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg> : null}
          {item.label}
        </Link>
      ))}
    </>
  )
}

export function Crumb({ items }: { items: Array<{ label: string; href?: string; title?: string }> }) {
  return (
    <nav className="ops-crumb" aria-label="面包屑">
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? <i className="sep" aria-hidden="true" /> : null}
          {item.href ? (
            <Link className="course-crumb" title={item.title} href={item.href}>
              {item.label}
            </Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

export function ConsoleShell({
  areaLabel,
  nav,
  navExtra,
  sidebarExtra,
  crumb,
  chatCenter = false,
  children,
}: {
  /** 品牌副标（生产工作台 / 运营控制台）。 */
  areaLabel: string
  nav: ReactNode
  /** 导航之后的附加块（课程切换器）。 */
  navExtra?: ReactNode
  /** 导航之后的附加链接（运营台入口）。 */
  sidebarExtra?: ReactNode
  crumb: ReactNode
  /** 对话工作台形态：主区通栏全高（WorkbenchSplit 贴顶到底）。 */
  chatCenter?: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const session = useSession()
  const { theme, toggle } = useWorkbenchTheme()
  const user = session.user

  return (
    <div className={chatCenter ? 'ops-app chat-center' : 'ops-app'}>
      <aside className="ops-sb">
        <div className="ops-brand">
          <span className="mk">趋</span>
          <span>
            <b>趋势课程</b>
            <small>{areaLabel}</small>
          </span>
        </div>
        <nav className="ops-menu">
          {nav}
          {navExtra}
        </nav>
        {sidebarExtra}
        <BuildInfo />
      </aside>
      <div className={chatCenter ? 'wb-col' : undefined}>
        <header className="ops-top">
          {crumb}
          <div className="ops-corner">
            <ThemeIconButton theme={theme} onToggle={toggle} />
            <UserMenu
              name={user?.displayName ?? user?.username ?? ''}
              role={user?.role ?? ''}
              onLogout={() => {
                void session.logout().then(() => router.replace(routes.login))
              }}
            />
          </div>
        </header>
        <main className="ops-main">{children}</main>
      </div>
    </div>
  )
}
