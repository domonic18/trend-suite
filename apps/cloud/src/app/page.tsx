import Link from 'next/link'

export default function Home() {
  return (
    <main className="wrap">
      <h1>trend-suite 云端服务</h1>
      <p className="sub">生产工作台入口</p>
      <p style={{ marginTop: 20 }}>
        <Link className="btn primary" href="/login">
          登录生产工作台
        </Link>
      </p>
    </main>
  )
}
