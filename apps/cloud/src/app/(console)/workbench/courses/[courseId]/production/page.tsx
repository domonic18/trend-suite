'use client'

import { useParams } from 'next/navigation'
import { useSession } from '@/features/accounts/SessionProvider'
import { ProductionBoard } from '@/features/production/ui/ProductionBoard'

/** 生产阶段：九步状态机看板。 */
export default function CourseProductionPage() {
  const params = useParams<{ courseId: string }>()
  const session = useSession()
  const role = session.user?.role
  return (
    <ProductionBoard
      courseId={params.courseId}
      canResync={role === 'admin' || role === 'producer'}
    />
  )
}
