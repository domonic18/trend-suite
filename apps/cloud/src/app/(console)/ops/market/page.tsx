'use client'

import { useSession } from '@/features/accounts/SessionProvider'
import { MarketSourcesPanel } from '@/features/market/ui/MarketSourcesPanel'
import { OpsShell } from '@/features/shell/OpsShell'

/** 运营控制台 · 行情源（鉴权与拒绝提示由 ConsoleGate 负责）。 */
export default function OpsMarketPage() {
  const session = useSession()
  const user = session.user
  if (!user) return null

  return (
    <OpsShell
      user={user}
      active="行情源"
      onLogout={() => {
        void session.logout()
      }}
    >
      <div className="ops-ph">
        <div>
          <div className="t">行情源</div>
          <div className="s">
            K 线数据来源统一维护：生产同步与运营台测试都从默认启用源拉数；测试连接与正式调用走同一客户端分支。
          </div>
        </div>
      </div>
      <MarketSourcesPanel canWrite={user.role === 'admin'} />
    </OpsShell>
  )
}
