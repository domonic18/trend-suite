'use client'

import type { ReactNode } from 'react'
import { routes } from '@/lib/routes'
import { ConsoleShell, Crumb, ShellNav } from './ConsoleShell'

const ICON_CONFIG = (
  <path
    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.86z"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  />
)

/** 运营控制台外壳：ConsoleShell 的配置（运营配置 + 返回工作台）。 */
export function OpsShell(props: { children: ReactNode }) {
  return (
    <ConsoleShell
      areaLabel="运营控制台"
      nav={
        <ShellNav
          group="系统"
          items={[
            { key: 'ops', label: '运营配置', href: routes.ops, icon: ICON_CONFIG, active: true },
            { key: 'workbench', label: '生产工作台', href: routes.workbench.index },
          ]}
        />
      }
      crumb={
        <Crumb
          items={[
            { label: '生产工作台', href: routes.workbench.index },
            { label: '运营配置' },
          ]}
        />
      }
    >
      {props.children}
    </ConsoleShell>
  )
}
