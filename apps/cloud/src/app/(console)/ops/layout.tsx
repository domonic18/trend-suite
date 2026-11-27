import type { ReactNode } from 'react'

/**
 * 运营台路由组：主题跟随工作台（data-wb-theme 默认深色）由 OpsShell
 * 挂载时设置（与 WorkbenchShell 同一 useWorkbenchTheme 机制，共享
 * localStorage 偏好）——console 全区统一视觉，仅门户/登录保持浅色。
 * 壳（OpsShell）在各页渲染（需要 user），本 layout 只做组语义占位。
 */
export default function OpsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
