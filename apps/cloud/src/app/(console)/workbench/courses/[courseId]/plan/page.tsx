import { redirect } from 'next/navigation'

/** 存量兼容：方案页已并入课程工作台（课程根），深链重定向。 */
export default function PlanRedirect() {
  redirect('../')
}
