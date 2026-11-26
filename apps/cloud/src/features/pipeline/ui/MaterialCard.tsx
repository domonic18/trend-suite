'use client'

import { Badge } from '@/components/ui/badge'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { useCallback, useState } from 'react'
import type {
  MediaAssetView,
  MediaFrameView,
  MediaStage,
  MediaUnderstandingItem,
  TranscriptResponse,
} from '@trend-suite/contracts'
import { Trash2 } from 'lucide-react'
import { ApiError } from '@/features/lib/http'
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
import { Button } from '@/components/ui/button'
import {
  cancelMaterial,
  deleteMaterial,
  deleteStage,
  getFrames,
  getTranscript,
  getUnderstanding,
  rerunStage,
  retryAsset,
} from '../api'
import { FrameGrid } from './FrameGrid'
import { formatDuration, formatSize, formatUploadedAt } from './format'
import { ProcessingSteps } from './ProcessingSteps'
import { READINESS_TEXT, formatTimestamp, readinessOf } from './processing'
import {
  STAGE_LABELS,
  STAGE_ORDER,
  stageStatusText,
  stageTone,
  stageViewOf,
} from './stages'
import { TranscriptView } from './TranscriptView'

/**
 * 素材卡（教师端需求 T4b）：一份素材 = 三段可独立操作的分析。
 *
 * 三段各有 查看 / 重新生成 / 删除结果：
 * - 重新生成默认只补缺口（按块去重，不重复计费）；
 * - 删除结果只删该段产物，素材字节与另外两段不受影响；
 * - 理解结果被方案引用时服务端拒绝删除（409），错误原文透传给教师。
 */

type Detail = {
  transcript: TranscriptResponse | null
  frames: MediaFrameView[]
  understanding: MediaUnderstandingItem[]
}

const EMPTY_DETAIL: Detail = { transcript: null, frames: [], understanding: [] }

export function MaterialCard(props: {
  asset: MediaAssetView
  onChanged: (asset: MediaAssetView) => void
  onRemoved: (assetId: string) => void
  onError: (message: string) => void
}) {
  const { asset, onChanged, onRemoved, onError } = props
  const [openStage, setOpenStage] = useState<MediaStage | null>(null)
  const [detail, setDetail] = useState<Detail>(EMPTY_DETAIL)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState<MediaStage | null>(null)
  /** 待确认动作（AlertDialog 受控：删除结果 / 停止加工 / 删除素材）。 */
  const [confirming, setConfirming] = useState<{ title: string; description: string; run: () => void } | null>(null)

  const readiness = readinessOf(asset)

  const loadDetail = useCallback(
    async (stage: MediaStage) => {
      setLoadingDetail(true)
      try {
        if (stage === 'transcript') {
          const transcript = await getTranscript(asset.id).catch(() => null)
          setDetail((prev) => ({ ...prev, transcript }))
        } else if (stage === 'frames') {
          const frames = await getFrames(asset.id).catch(() => ({ items: [] }))
          setDetail((prev) => ({ ...prev, frames: frames.items }))
        } else {
          const understanding = await getUnderstanding(asset.id).catch(() => [])
          setDetail((prev) => ({ ...prev, understanding }))
        }
      } finally {
        setLoadingDetail(false)
      }
    },
    [asset.id],
  )

  const open = useCallback(
    (stage: MediaStage) => {
      const next = openStage === stage ? null : stage
      setOpenStage(next)
      if (next) void loadDetail(next)
    },
    [openStage, loadDetail],
  )

  const runStage = useCallback(
    async (stage: MediaStage, mode: 'rerun' | 'clear') => {
      setBusy(stage)
      try {
        if (mode === 'rerun') {
          onChanged(await rerunStage(asset.id, stage, false))
        } else {
          onChanged(await deleteStage(asset.id, stage))
        }
      } catch (err) {
        onError(err instanceof ApiError ? err.message : '操作失败，请稍后再试')
      } finally {
        setBusy(null)
      }
    },
    [asset.id, onChanged, onError],
  )

  const stop = useCallback(async () => {
    try {
      onChanged(await cancelMaterial(asset.id))
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '停止失败，请稍后再试')
    }
  }, [asset.id, onChanged, onError])

  const retry = useCallback(async () => {
    try {
      onChanged((await retryAsset(asset.id)).asset)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '重新加工失败，请稍后再试')
    }
  }, [asset.id, onChanged, onError])

  const remove = useCallback(async () => {
    try {
      await deleteMaterial(asset.id)
      onRemoved(asset.id)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '删除失败，请稍后再试')
    }
  }, [asset.id, onRemoved, onError])

  return (
    <article className="matcard">
      <div className="matcard-h">
        <div className="mh-name">
          <b>{asset.fileName}</b>
          <span className="mh-id">{asset.id}</span>
        </div>
        <div className="mh-st">
          <span className={`st st-${readiness}`}>
            <i />
            {READINESS_TEXT[readiness]}
          </span>
          <span className="mh-meta">
            {[
              formatDuration(asset.durationS),
              asset.byteSize !== null ? formatSize(asset.byteSize) : null,
              formatUploadedAt(asset.createdAt),
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
        </div>
      </div>

      {readiness === 'failed' && asset.errorMessage ? (
        <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{asset.errorMessage}
          <Button variant="link" size="sm" onClick={() => void retry()}>
            重试（不重算已完成部分）
          </Button></AlertDescription>
    </Alert>
      ) : null}

      <div className="matcard-stages">
        {STAGE_ORDER.map((stage) => {
          const view = stageViewOf(asset, stage)
          const tone = stageTone(view.status)
          const isOpen = openStage === stage
          return (
            <div className={`mstage ${tone}`} key={stage}>
              <div className="ms-h">
                <i className="dot" />
                {STAGE_LABELS[stage]}
              </div>
              <div className="ms-c">{stageStatusText(stage, view)}</div>
              {view.errorMessage ? <div className="ms-err">{view.errorMessage}</div> : null}
              <div className="ms-a">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => open(stage)}
                  title="查看这一段的产物"
                >
                  {isOpen ? '收起' : '查看'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  title="只补缺口，不重复计费（要清空重来，先「删除结果」再「重新生成」）"
                  onClick={() => void runStage(stage, 'rerun')}
                >
                  {busy === stage ? '处理中…' : '重新生成'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    setConfirming({
                      title: `删除「${STAGE_LABELS[stage]}」的结果？`,
                      description: '只删这一段的产物，素材文件与另外两段不受影响。',
                      run: () => void runStage(stage, 'clear'),
                    })
                  }
                >
                  删除结果
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {openStage ? (
        <div className="matcard-detail">
          <ProcessingSteps asset={asset} />
          {openStage === 'transcript' ? (
            <div>
              <h4>
                ASR 逐字稿
                <Badge className="tag gray">
                  {detail.transcript ? detail.transcript.segments.length : asset.segmentCount} 段
                </Badge>
              </h4>
              {loadingDetail ? (
                <div className="empty">逐字稿加载中…</div>
              ) : detail.transcript ? (
                <TranscriptView transcript={detail.transcript} />
              ) : (
                <div className="empty">还没有逐字稿结果。</div>
              )}
            </div>
          ) : null}
          {openStage === 'frames' ? (
            <div>
              <h4>
                关键帧
                <Badge className="tag gray">{asset.frameCount} 张</Badge>
              </h4>
              {loadingDetail ? (
                <div className="empty">关键帧加载中…</div>
              ) : (
                <FrameGrid frames={detail.frames} />
              )}
            </div>
          ) : null}
          {openStage === 'understanding' ? (
            <div>
              <h4>
                视频理解
                <Badge className="tag gray">{detail.understanding.length} 条</Badge>
              </h4>
              {loadingDetail ? (
                <div className="empty">理解结果加载中…</div>
              ) : detail.understanding.length === 0 ? (
                <div className="empty">还没有理解结果。理解是起草大纲的输入，先重跑这一段。</div>
              ) : (
                <div className="ulist">
                  {detail.understanding.map((unit) => (
                    <div className="uitem" key={unit.id}>
                      <span className="ts">{formatTimestamp(unit.startMs)}</span>
                      <div>
                        <div className="utext">{unit.text}</div>
                        {unit.teachingPoints.length > 0 ? (
                          <ul className="upoints">
                            {unit.teachingPoints.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="matcard-f">
        {readiness === 'queued' || readiness === 'running' ? (
          <Button
            variant="outline"
            onClick={() =>
              setConfirming({
                title: '停止加工？',
                description: '排队任务直接取消，运行中的在阶段边界安全中止，已产出的段落与关键帧会保留。',
                run: () => void stop(),
              })
            }
          >
            停止加工
          </Button>
        ) : null}
        {readiness === 'stopped' ? (
          <Button variant="outline" onClick={() => void retry()}>
            重新加工
          </Button>
        ) : null}
        <span className="grow" />
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive"
          title="删除素材"
          aria-label="删除素材"
          onClick={() =>
            setConfirming({
              title: `删除素材「${asset.fileName}」？`,
              description: '段落、关键帧、理解结果与文件字节将一并清理，不可恢复。',
              run: () => void remove(),
            })
          }
        >
          <Trash2 />
        </Button>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirming?.run()
                setConfirming(null)
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
