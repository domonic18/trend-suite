'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * 下一步引导横幅（原型 teacher-plan nextaction）：
 * 任何状态都回答「现在该干什么」，动作按钮就地滚动定位或跳转。
 */
export function NextActionBanner({
  tone,
  children,
  action,
}: {
  tone: 'info' | 'warn' | 'ok'
  children: ReactNode
  action?: { label: string; href?: string; onClick?: () => void }
}) {
  return (
    <div className={`nextact ${tone}`}>
      <span className="na-t">{children}</span>
      {action ? (
        action.href ? (
          <Link className="btn na-a" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className="btn na-a" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  )
}
