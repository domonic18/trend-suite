import { LoginForm } from '@/features/accounts/ui/LoginForm'

export const metadata = { title: '登录 · 生产工作台' }

/** 登录页：品牌侧栏（恒深色装饰面）+ 登录表单。不挂 data-wb-theme，天然浅色。 */
export default function LoginPage() {
  return (
    <main className="grid min-h-screen grid-cols-[1.1fr_0.9fr]">
      <aside
        className="flex flex-col px-[52px] py-[56px] text-[#dbe7fb]"
        style={{
          background: `radial-gradient(circle at 18% 18%, rgba(37, 99, 235, 0.22), transparent 42%),
    radial-gradient(circle at 82% 76%, rgba(15, 157, 118, 0.12), transparent 38%),
    linear-gradient(160deg, #11203d, #1d3b74)`,
        }}
      >
        <div className="grid size-14 place-items-center rounded-xl bg-white/12 text-2xl font-bold text-white">
          趋
        </div>
        <h2 className="mt-[26px] mb-2 text-2xl font-[650] text-white">生产工作台</h2>
        <p className="max-w-[40ch] text-[13.5px] leading-[1.8] text-[#9db4dd]">
          与制作 Agent 协作完成教材生产：上传视频得到原始数据，Agent 从原始数据生成教材。
        </p>
        <ul className="mt-[18px] list-none p-0 text-[13px] leading-[2.1] text-[#b9c6e4]">
          <li className="before:mr-[10px] before:text-[#6f9bff] before:content-['—']">
            模型云端预置，零安装、零密钥
          </li>
          <li className="before:mr-[10px] before:text-[#6f9bff] before:content-['—']">
            教师写入恒为 draft，签批与发布归运营
          </li>
          <li className="before:mr-[10px] before:text-[#6f9bff] before:content-['—']">
            仅 producer 角色可登录本工作台
          </li>
        </ul>
      </aside>
      <section className="flex flex-col justify-center bg-soft px-[56px] py-12">
        <LoginForm />
      </section>
    </main>
  )
}
