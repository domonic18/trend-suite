// 数据库迁移入口：按序执行 db/migrations/*.sql（幂等）。
//
// 当前状态：**尚未实现**——本脚本只做「清点 + 显式告警」，不执行任何 DDL。
// 之所以不允许它静默空跑：发布流程把「迁移先行」当硬门禁（deploy.sh 里迁移失败即中止发布、
// 旧版本继续服务）。一个永远成功的空跑会让这道门禁失效——schema 没变，线上却以为已经迁移过。
// 接入真实实现（按序执行 SQL、记录已应用版本、失败即中止）前，schema 变更不会生效。
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations')

const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort()

console.warn(
  `[migrate] TODO 未实现：本次不执行任何 DDL（待执行文件 ${files.length} 个：${files.join(', ') || '无'}）`,
)
console.warn('[migrate] 发布流程把「迁移先行」当硬门禁，空跑会让门禁失效：schema 不会变')
