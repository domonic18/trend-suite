'use client'

import { useParams } from 'next/navigation'
import { MaterialPanel } from '@/features/pipeline/ui/MaterialPanel'

/** 素材阶段：上传与转写。 */
export default function CourseMaterialPage() {
  const params = useParams<{ courseId: string }>()
  return <MaterialPanel courseId={params.courseId} />
}
