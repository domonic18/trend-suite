'use client'

import { useCallback, useEffect, useState } from 'react'
import { storageKeys } from '@/lib/storageKeys'
import { LogOut, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
    const saved = window.localStorage.getItem(storageKeys.theme)
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
      window.localStorage.setItem(storageKeys.theme, next)
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
  const label = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onToggle}>
          {theme === 'dark' ? <Moon className="size-[15px]" /> : <Sun className="size-[15px]" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === 'dark' ? '切换到浅色' : '切换到深色'}</TooltipContent>
    </Tooltip>
  )
}

/** 右上角用户菜单（行业惯例：头像钮 + 下拉，含身份与退出）。 */
export function UserMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ops-ava" title={name} aria-label="用户菜单">
          {name.slice(0, 1)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ops-usermenu-pop">
        <div className="ops-usermenu-info">
          <b>{name}</b>
          <small>{role}</small>
        </div>
        <DropdownMenuItem className="ops-usermenu-out" onSelect={() => onLogout()}>
          <LogOut className="size-3.5" /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
