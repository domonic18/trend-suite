'use client'

import { routes } from '@/lib/routes'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError } from '@/features/lib/http'
import { login } from '../api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    // 提交时从 DOM 读实际值：浏览器密码管理器的自动填充只写 DOM、不触发
    // React onChange——受控 state 可能还是空串，直接提交会被服务端判
    // 「参数不合法」。FormData 以用户看到的为准。
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get('username') ?? username).trim()
    const pass = String(data.get('password') ?? password)
    try {
      await login(name, pass)
      // setToken 已发布会话变更：Provider 重新校验后放行，SPA 直达。
      router.replace(routes.workbench.index)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
      setBusy(false)
    }
  }

  return (
    <form className="max-w-[400px]" onSubmit={onSubmit}>
      <h1 className="mb-1 text-[21px] font-[650]">登录生产工作台</h1>
      <p className="mb-6 text-[13.5px] text-mut">浏览器会话 · sessionStorage，不落 Cookie</p>

      {error ? (
        <Alert variant="destructive" className="mb-3.5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-3.5 grid gap-1.5">
        <Label htmlFor="username">用户名</Label>
        <Input
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </div>

      <div className="mb-3.5 grid gap-1.5">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? '登录中…' : '登录'}
      </Button>

      <p className="mt-[18px] text-[12.5px] leading-[1.9] text-faint">
        首次使用请联系运营创建 producer 账号；忘记密码由管理员重置。
        <br />
        学员入口在官网门户，学员账号看不到本工作台。
      </p>
    </form>
  )
}
