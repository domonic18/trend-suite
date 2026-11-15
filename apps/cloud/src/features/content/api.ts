import { courseListResponse, createCourseResponse, type CourseView } from '@trend-suite/contracts'
import { getToken } from '@/features/accounts/session'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string }
    } | null
    throw new ApiError(body?.error?.message ?? `请求失败（${res.status}）`, res.status, body?.error?.code)
  }
  return (await res.json()) as T
}

export async function listCourses(): Promise<CourseView[]> {
  const data = await request<unknown>('/v1/admin/content/courses')
  return courseListResponse.parse(data).items
}

export async function createCourse(title: string): Promise<CourseView> {
  const data = await request<unknown>('/v1/admin/content/courses', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  return createCourseResponse.parse(data).course
}
