import { routes } from '@/lib/routes'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * 门户首页：品牌落地页（与登录页同一品牌语言——深蓝渐变 + 光斑）。
 * 教师从这里进生产工作台；学员端在官网门户（本页不是学员入口）。
 */
export default function Home() {
  return (
    <main
      className="grid min-h-screen place-items-center px-6"
      style={{
        background: `radial-gradient(circle at 18% 18%, rgba(37, 99, 235, 0.22), transparent 42%),
    radial-gradient(circle at 82% 76%, rgba(15, 157, 118, 0.12), transparent 38%),
    linear-gradient(160deg, #11203d, #1d3b74)`,
      }}
    >
      <div className="flex w-full max-w-[440px] flex-col items-center text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-white/12 text-3xl font-bold text-white">
          趋
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">趋势课程</h1>
        <p className="mt-3 max-w-[36ch] text-[14px] leading-[1.9] text-[#9db4dd]">
          与制作 Agent 协作完成教材生产：上传视频得到原始数据，
          Agent 从原始数据生成教材——大纲、课件、K 线与练习题。
        </p>
        <Button asChild className="mt-8 w-full py-3 text-[14.5px]">
          <Link href={routes.login}>登录生产工作台</Link>
        </Button>
        <p className="mt-5 text-[12.5px] text-[#6f7f9e]">
          模型云端预置 · 零安装零密钥 · 学员入口在官网门户
        </p>
      </div>
    </main>
  )
}
