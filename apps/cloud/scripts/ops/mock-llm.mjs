/**
 * 本地演示用 mock LLM 服务器（无外部依赖，node 直跑）：
 *   node scripts/ops/mock-llm.mjs
 *
 * 用途：开发机没有真实模型密钥时的本机演示/联调——把 ai_models 里 llm 用途的
 * 条目 base_url 指到 http://127.0.0.1:8941（运营控制台 /ops/models 可改），
 * worker 与 dev server 的模型调用就会打到本进程。
 *
 * 行为：按 system 提示词里的角色分流——
 *  - 「课程目录设计助手」（方案起草的目录代拟阶段）：回一份固定三级目录；
 *  - 「课程方案起草助手」（方案起草的草案阶段）：解析 user 提示词里
 *    「人工目录（id: 标题）」段，为每个目录节点产出匹配、概念与课时计划；
 *  - 其他任务：回 `{}`（zod 默认值兜底，够链路跑通，内容为空）。
 *
 * 只供本机开发演示，绝不部署：生产/预发环境的模型条目是真实上游。
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_LLM_PORT ?? 8941)

/** 从提示词里解析「id: 标题」目录行（草案阶段的 user 提示词携带）。 */
function parseOutlineNodes(user) {
  const block = user.split('## 人工目录（id: 标题）')[1] ?? ''
  const lines = block.split('\n').slice(1)
  const nodes = []
  for (const line of lines) {
    const match = /^(?<id>\S+):\s*(?<title>.+)$/.exec(line.trim())
    if (!match) continue
    nodes.push({ id: match.groups.id, title: match.groups.title.trim() })
  }
  return nodes
}

function curriculumDraft(user) {
  const nodes = parseOutlineNodes(user)
  return {
    matches: nodes.map((node) => ({ nodeId: node.id, matchScore: 0.85 })),
    concepts: nodes.slice(0, 25).map((node) => ({
      name: node.title.slice(0, 40),
      aliases: [],
      definition: `${node.title.slice(0, 16)}的核心内涵与判断要点`,
    })),
    edges: [],
    lessons: nodes.slice(0, 40).map((node) => ({
      sectionId: node.id,
      title: node.title,
      subLessonCount: 3,
      estimatedMinutes: 20,
      parallelSlot: 1,
    })),
  }
}

function curriculumOutline() {
  return {
    sections: [
      { level: 1, title: '基础篇' },
      { level: 2, title: '核心概念' },
      { level: 3, title: '趋势的定义' },
      { level: 3, title: '趋势的三要素' },
      { level: 2, title: '实战应用' },
      { level: 3, title: '案例解析' },
    ],
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !(req.url ?? '').endsWith('/chat/completions')) {
    res.writeHead(404)
    res.end()
    return
  }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    let payload = null
    try {
      const parsed = JSON.parse(body)
      const system = String(parsed.messages?.[0]?.content ?? '')
      const user = String(parsed.messages?.[1]?.content ?? '')
      if (system.includes('目录设计助手')) payload = curriculumOutline()
      else if (system.includes('方案起草助手')) payload = curriculumDraft(user)
      else payload = {}
    } catch {
      payload = {}
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    )
  })
})
server.listen(PORT, '127.0.0.1', () => console.log(`[mock-llm] http://127.0.0.1:${PORT}/chat/completions`))
