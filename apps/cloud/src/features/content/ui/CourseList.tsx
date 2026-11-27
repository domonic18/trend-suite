'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { CourseSummaryView } from '@trend-suite/contracts'
import { BookOpen, Pencil, X } from 'lucide-react'
import { ApiError } from '@/features/lib/http'
import { deleteCourse, renameCourse } from '../api'
import { useCourses } from './CoursesProvider'
import { NewCoursePanel } from './NewCoursePanel'
import { courseScaleOf, courseStatusTagOf, progressOf } from './coursePhase'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

function formatTime(iso: string): string {
  const date = new Date(iso)
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return date.getFullYear() === new Date().getFullYear() ? md : `${date.getFullYear()}-${md}`
}

/** 封面色相（借鉴 SasanImmersive 课程卡）：课程 id 哈希出稳定 hue，无封面图也有视觉锚点。 */
function coverHueOf(id: string): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

export function CourseList() {
  const { courses, loading, error, refresh } = useCourses()
  const [renaming, setRenaming] = useState<CourseSummaryView | null>(null)
  const [deleting, setDeleting] = useState<CourseSummaryView | null>(null)
  // 新建课程是页面内嵌面板（Sasan 式）：#create 锚点驱动，无弹窗无路由跳转。
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const sync = () => setCreating(window.location.hash === '#create')
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const closeCreate = () => {
    window.location.hash = ''
  }

  if (creating) {
    return (
      <NewCoursePanel
        onCancel={closeCreate}
        onCreated={() => {
          closeCreate()
          void refresh()
        }}
      />
    )
  }

  return (
    <section>
      {error ? (
        <Alert variant="destructive" className="mb-3.5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="empty">课程加载中…</div>
      ) : courses.length === 0 ? (
        <a
          href="#create"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-12 text-mut no-underline transition-colors hover:border-primary hover:text-primary"
        >
          <BookOpen className="size-7" strokeWidth={1.4} aria-hidden="true" />
          <span className="text-[13px]">还没有课程</span>
          <span className="text-[12px]">新建课程 →</span>
        </a>
      ) : (
        <div className="cards">
          {courses.map((course) => {
            const tag = courseStatusTagOf(course)
            const progress = Math.round(progressOf(course) * 100)
            return (
              <article
                className="card clickable"
                key={course.id}
                style={{ '--cover-hue': coverHueOf(course.id) } as CSSProperties}
              >
                <Link className="card-go" href={`/workbench/courses/${course.id}`} aria-label={`进入课程 ${course.title}`} />
                <div className="card-cover" aria-hidden="true">
                  <span className="card-mono">{Array.from(course.title)[0] ?? '课'}</span>
                </div>
                <div className="card-body">
                  <div className="card-top">
                    <b>{course.title}</b>
                    <Badge className={`tag ${tag.tone}`}>{tag.text}</Badge>
                  </div>
                  <div className="meta">
                    {courseScaleOf(course)} · {formatTime(course.createdAt)}
                  </div>
                  {course.sectionCount > 0 ? (
                    <Progress value={progress} aria-label="制作进度" />
                  ) : null}
                </div>
                <span className="card-acts">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="改名"
                    aria-label={`改名 ${course.title}`}
                    onClick={() => setRenaming(course)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    title="删除"
                    aria-label={`删除 ${course.title}`}
                    onClick={() => setDeleting(course)}
                  >
                    <X />
                  </Button>
                </span>
              </article>
            )
          })}
        </div>
      )}

      <div className="cards mt-3.5">
        <a className="card add" href="#create">
          ＋ 新建课程
        </a>
      </div>

      <RenameDialog course={renaming} onClose={() => setRenaming(null)} onDone={() => void refresh()} />
      <DeleteDialog course={deleting} onClose={() => setDeleting(null)} onDone={() => void refresh()} />
    </section>
  )
}

/** 改名弹窗：一行输入，保存即 PATCH。 */
function RenameDialog({
  course,
  onClose,
  onDone,
}: {
  course: CourseSummaryView | null
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 打开（course 到位）即填入当前课程名；受控 open 变化不触发 onOpenChange
  useEffect(() => {
    if (course) {
      setTitle(course.title)
      setError(null)
    }
  }, [course])

  async function submit() {
    if (!course || !title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await renameCourse(course.id, title.trim())
      onClose()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '改名失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={course !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>课程改名</DialogTitle>
        </DialogHeader>
        <div className="px-4 pt-3 pb-1">
          <div className="mb-3.5 grid gap-1.5">
            <Label htmlFor="rename-title">课程名称</Label>
            <Input
              id="rename-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              autoFocus
            />
          </div>
          {error ? (
            <Alert variant="destructive" className="mb-3.5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="gap-2 border-t border-line px-4 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy || !title.trim() || title.trim() === course?.title}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 删除确认：说明级联后果，确认才删。 */
function DeleteDialog({
  course,
  onClose,
  onDone,
}: {
  course: CourseSummaryView | null
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!course || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteCourse(course.id)
      onClose()
      onDone()
    } catch (err) {
      // 非 ApiError（fetch 网络层异常：超时 / 连接重置）时透出原始信息，
      // 便于区分「接口报错」与「网络没到服务端」。
      setError(
        err instanceof ApiError ? err.message : `删除失败：${String(err instanceof Error ? err.message : err)}`,
      )
      setBusy(false)
    }
  }

  return (
    <Dialog open={course !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除课程</DialogTitle>
        </DialogHeader>
        <div className="px-4 pt-3 pb-1">
          <p className="text-[13.5px] leading-[1.8]">
            将删除课程<b>{course ? `「${course.title}」` : ''}</b>
            ，连同它的全部素材、方案、生产产物与 Agent 对话记录，<b>不可恢复</b>。
          </p>
          {error ? (
            <Alert variant="destructive" className="mt-3.5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="gap-2 border-t border-line px-4 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
