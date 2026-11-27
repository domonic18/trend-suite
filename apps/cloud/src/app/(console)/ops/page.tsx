'use client'

import { useSession } from '@/features/accounts/SessionProvider'
import { OpsModelsPanel } from '@/features/models/ui/OpsModelsPanel'
import { MarketSourcesPanel } from '@/features/market/ui/MarketSourcesPanel'
import { OpsShell } from '@/features/shell/OpsShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * 运营控制台（Sasan settings 模式：单页 + 页头 Tabs）：模型配置与行情源
 * 合并为同页双 tab——壳与主题不卸载、面板数据各自缓存于组件树，
 * 切换零路由成本（此前的 /ops/models ↔ /ops/market 跨页切换每次整页
 * 重挂 + 三连发请求，是切换卡顿的根因）。旧双子路由删除（零兼容）。
 */
export default function OpsPage() {
  const session = useSession()
  const user = session.user
  if (!user) return null

  return (
    <OpsShell
      user={user}
      active="运营配置"
      onLogout={() => {
        void session.logout()
      }}
    >
      <Tabs defaultValue="models">
        <div className="page-head" style={{ marginTop: 26 }}>
          <h2>运营配置</h2>
          <div className="actions">
            <TabsList>
              <TabsTrigger value="models">模型配置</TabsTrigger>
              <TabsTrigger value="market">行情源</TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent value="models" className="mt-0">
          <OpsModelsPanel canWrite={user.role === 'admin'} />
        </TabsContent>
        <TabsContent value="market" className="mt-0">
          <MarketSourcesPanel canWrite={user.role === 'admin'} />
        </TabsContent>
      </Tabs>
    </OpsShell>
  )
}
