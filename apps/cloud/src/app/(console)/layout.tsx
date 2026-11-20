'use client'

import type { ReactNode } from 'react'
import { SessionProvider } from '@/features/accounts/SessionProvider'
import { ConsoleGate } from '@/features/shell/ConsoleGate'

/**
 * 控制台外壳（登录页 / 运营控制台 / 教师工作台同组）。
 *
 * layout 在路由切换时不卸载 → 会话只校验一次，页面切换不再闪「正在校验登录状态」。
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConsoleGate>{children}</ConsoleGate>
    </SessionProvider>
  )
}
