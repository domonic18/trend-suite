import { redirect } from 'next/navigation'

/** 存量兼容：分节预览迁至课程下的 sections/[sectionId]/preview。 */
export default function PreviewRedirect({
  params,
}: {
  params: Promise<{ courseId: string; sectionId: string }>
}) {
  return (async () => {
    const { courseId, sectionId } = await params
    redirect(`/workbench/courses/${courseId}/sections/${sectionId}/preview`)
  })()
}
