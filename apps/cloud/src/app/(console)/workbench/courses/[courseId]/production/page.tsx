'use client'

import { useParams } from 'next/navigation'
import { useSession } from '@/features/accounts/SessionProvider'
import { ProductionStudio } from '@/features/production/ui/ProductionStudio'

/** 生产阶段：课件制作台（课时树 + 当前节工作区 + Agent 对话流）。 */
export default function CourseProductionPage() {
  const params = useParams<{ courseId: string }>()
  const session = useSession()
  const role = session.user?.role
  return (
    <ProductionStudio
      courseId={params.courseId}
      canControl={role === 'admin' || role === 'producer'}
    />
  )
}
