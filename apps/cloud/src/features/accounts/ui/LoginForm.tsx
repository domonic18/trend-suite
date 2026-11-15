'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError } from '@/features/lib/http'
import { login } from '../api'

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
    try {
      await login(username.trim(), password)
      router.replace('/workbench')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-card" onSubmit={onSubmit}>
      <h1>登录生产工作台</h1>
      <p className="sub">浏览器会话 · sessionStorage，不落 Cookie</p>

      {error ? <div className="notice err">{error}</div> : null}

      <div className="field">
        <label htmlFor="username">用户名</label>
        <input
          id="username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">密码</label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? '登录中…' : '登录'}
      </button>

      <p className="login-foot">
        首次使用请联系运营创建 producer 账号；忘记密码由管理员重置。
        <br />
        学员入口在官网门户，学员账号看不到本工作台。
      </p>
    </form>
  )
}
