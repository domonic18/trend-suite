'use client'

import { useSession } from '@/features/accounts/SessionProvider'
import { OpsModelsPanel } from '@/features/models/ui/OpsModelsPanel'
import { OpsShell } from '@/features/shell/OpsShell'

/** 运营控制台 · 模型配置（鉴权与拒绝提示由 ConsoleGate 负责）。 */
export default function OpsModelsPage() {
  const session = useSession()
  const user = session.user
  if (!user) return null

  return (
    <OpsShell
      user={user}
      active="模型配置"
      onLogout={() => {
        void session.logout()
      }}
    >
      <div className="ops-ph">
        <div>
          <div className="t">模型配置</div>
          <div className="s">
            模型条目统一维护（内容生成 / 视觉理解 / 语音转写 / 向量嵌入），按任务槽位绑定主备；密钥仅在此管理。
          </div>
        </div>
      </div>
      <OpsModelsPanel canWrite={user.role === 'admin'} />
    </OpsShell>
  )
}
