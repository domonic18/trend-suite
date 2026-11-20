'use client'

import { useParams } from 'next/navigation'
import { SectionPreview } from '@/features/content/ui/SectionPreview'

/** 分节正文预览（生产阶段下钻）。 */
export default function SectionPreviewPage() {
  const params = useParams<{ courseId: string; sectionId: string }>()
  return <SectionPreview courseId={params.courseId} sectionId={params.sectionId} />
}
