import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function Home() {
  return (
    <main className="wrap">
      <h1>trend-suite 云端服务</h1>
      <p className="sub">生产工作台入口</p>
      <p className="mt-5">
        <Button asChild>
          <Link href="/login">登录生产工作台</Link>
        </Button>
      </p>
    </main>
  )
}
