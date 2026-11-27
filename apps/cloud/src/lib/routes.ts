/**
 * 页面路由单一真相（评审 P0）：此前路由字符串散落 13 个文件 ~28 处，删除
 * 路由后留下悬空引用（登录跳 /ops/models 404、测试断言陈旧）。
 * 全仓一律经此生成/引用路径；`routes.test.ts` 校验每个路径在 src/app 有
 * 对应 page ——删路由不删引用会直接挂测试。
 */
export const routes = {
  home: '/',
  login: '/login',
  ops: '/ops',
  workbench: {
    index: '/workbench',
    /** 课程列表页内嵌创建面板（#create 锚点）。 */
    create: '/workbench#create',
    library: '/workbench/library',
    /** 课程工作台（方案期与制作期同一页面）。 */
    course: (courseId: string) => `/workbench/courses/${courseId}`,
    preview: (courseId: string, sectionId: string) =>
      `/workbench/courses/${courseId}/sections/${sectionId}/preview`,
  },
} as const
