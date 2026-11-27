import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  ChartCandlestick,
  ClipboardList,
  Image,
  ListTree,
  MousePointerClick,
  Video,
} from 'lucide-react'

/**
 * 课件元素页签的统一元数据（Sasan 式 icon + 文字）：两态工作区共用，
 * 图标让页签在窄栏/密集场景下仍可辨析；空态文案只写「还没有什么」，
 * 呈现形态由 EmptyPanel 承载（图示化，不再是一行灰字）。
 */
export type WorkspaceTabKey =
  | 'outline'
  | 'artifact'
  | 'figures'
  | 'video'
  | 'kline'
  | 'quiz'
  | 'interactive'

export const WORKSPACE_TABS: ReadonlyArray<{
  key: WorkspaceTabKey
  label: string
  icon: LucideIcon
  emptyText: string
}> = [
  { key: 'outline', label: '大纲', icon: ListTree, emptyText: '还没有大纲' },
  { key: 'artifact', label: '课件', icon: BookOpen, emptyText: '还没有课件' },
  { key: 'figures', label: '配图', icon: Image, emptyText: '还没有配图' },
  { key: 'video', label: '视频', icon: Video, emptyText: '还没有视频' },
  { key: 'kline', label: 'K线图', icon: ChartCandlestick, emptyText: '还没有 K 线图' },
  { key: 'quiz', label: '练习题', icon: ClipboardList, emptyText: '还没有练习题' },
  { key: 'interactive', label: '互动', icon: MousePointerClick, emptyText: '还没有互动课件' },
]

/** 页签空态：图标 + 短文案的图示块（纯呈现，制作推进后内容原位长出）。 */
export function EmptyPanel({ tabKey }: { tabKey: WorkspaceTabKey }) {
  const tab = WORKSPACE_TABS.find((item) => item.key === tabKey)!
  const Icon = tab.icon
  return (
    <div className="flex flex-col items-center gap-2.5 py-14 text-mut">
      <Icon className="size-8" strokeWidth={1.3} aria-hidden="true" />
      <span className="text-[13px]">{tab.emptyText}</span>
      <span className="text-[12px] text-faint">制作推进后自动出现在这里</span>
    </div>
  )
}
