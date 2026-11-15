import { LoginForm } from '@/features/accounts/ui/LoginForm'

export const metadata = { title: '登录 · 生产工作台' }

export default function LoginPage() {
  return (
    <main className="login-page">
      <aside className="login-aside">
        <div className="mk">趋</div>
        <h2>生产工作台</h2>
        <p>与制作 Agent 协作完成教材生产：上传视频得到原始数据，Agent 从原始数据生成教材。</p>
        <ul>
          <li>模型云端预置，零安装、零密钥</li>
          <li>教师写入恒为 draft，签批与发布归运营</li>
          <li>仅 producer 角色可登录本工作台</li>
        </ul>
      </aside>
      <section className="login-form">
        <LoginForm />
      </section>
    </main>
  )
}
