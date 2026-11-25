'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 工作台主题切换（arch/08 §6）：把 data-wb-theme 写到 <html> 上——
 * 根作用域（body 的 color/background 等）与全子树的 var() 都按主题解析。
 * localStorage['wb.theme'] 持久化，默认深色；首帧由 workbench layout 的
 * inline 脚本同步设属性防闪白。卸载（离开工作台）时移除属性，门户/登录
 * 回到 :root 浅色。
 */
export function useWorkbenchTheme(): { theme: 'dark' | 'light'; toggle: () => void } {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = window.localStorage.getItem('wb.theme')
    const next = saved === 'light' || saved === 'dark' ? saved : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-wb-theme', next)
    return () => {
      document.documentElement.removeAttribute('data-wb-theme')
    }
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem('wb.theme', next)
      document.documentElement.setAttribute('data-wb-theme', next)
      return next
    })
  }, [])

  return { theme, toggle }
}

/** 右上角主题图标钮（行业惯例：日月图标切换，随当前主题互换）。 */
export function ThemeIconButton({
  theme,
  onToggle,
}: {
  theme: 'dark' | 'light'
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="ops-iconbtn"
      onClick={onToggle}
      title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}

/** 右上角用户菜单（行业惯例：头像钮 + 下拉，含身份与退出）。 */
export function UserMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="ops-usermenu" ref={rootRef}>
      <button
        type="button"
        className="ops-ava"
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((prev) => !prev)}
      >
        {name.slice(0, 1)}
      </button>
      {open ? (
        <div className="ops-usermenu-pop" role="menu">
          <div className="ops-usermenu-info">
            <b>{name}</b>
            <small>{role}</small>
          </div>
          <button type="button" role="menuitem" className="ops-usermenu-out" onClick={onLogout}>
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  )
}
