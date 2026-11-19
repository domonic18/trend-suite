'use client'

import type { FigureView } from '@trend-suite/contracts'

/**
 * 图示卡三路（arch/05 §8）：keyframe 签名帧图、diagram 内联服务端渲好的
 * SVG、generated 装饰图——caption 统一走图注位。
 */

const KIND_LABEL: Record<FigureView['kind'], string> = {
  keyframe: '关键帧',
  diagram: '示意图',
  generated: '装饰图',
}

export function FigureCard({ figure }: { figure: FigureView }) {
  return (
    <figure className="doc-fig">
      {figure.kind === 'diagram' && figure.svg ? (
        // 服务端确定性渲染产物（模板白名单 + params schema 过关后才落库）。
        <div className="fig-svg" dangerouslySetInnerHTML={{ __html: figure.svg }} />
      ) : figure.url ? (
        <img src={figure.url} alt={figure.caption} loading="lazy" />
      ) : (
        <div className="fig-empty">该图示尚无可展示的图像</div>
      )}
      <figcaption>
        <span className="tag gray">{KIND_LABEL[figure.kind]}</span>
        {figure.caption}
      </figcaption>
    </figure>
  )
}
