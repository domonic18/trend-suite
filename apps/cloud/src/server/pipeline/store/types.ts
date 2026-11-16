import 'server-only'

/** 直传目标：浏览器 PUT 字节到此地址，字节不经业务进程内存中转（arch/05 §3.1）。 */
export type UploadTarget = {
  method: 'PUT'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

/** 媒体校验结果（arch/05 §3.3）。 */
export type MediaProbe = {
  videoOk: boolean
  audioOk: boolean
  durationS: number | null
}

/**
 * 媒体存储抽象（arch/05 §3.2）：接口不变，切换只换实现。
 * local = 本地文件系统；cos = 对象存储（预签名直传）。
 */
export interface MediaStore {
  readonly kind: 'local' | 'cos'

  /** 签发直传目标：本地模式指向应用自身的 PUT 路由，字节边收边落盘。 */
  uploadTarget(input: {
    assetId: string
    byteSize: number
    sha256?: string | undefined
    expiresAt: Date
  }): UploadTarget

  /** 接收直传字节并落暂存位：流式写盘，不在内存里攒全量。 */
  receiveUpload(input: {
    assetId: string
    body: ReadableStream<Uint8Array>
    /** 硬上限（2GiB）：超了是 413。 */
    maxBytes: number
    /** 声明字节数：超了是 400（与声明不符）。 */
    declaredBytes: number
    sha256?: string | undefined
  }): Promise<{ byteSize: number; sha256: string }>

  /** 取原始字节的可读路径（probe 用）。 */
  sourcePath(assetId: string): Promise<string>

  /** 校验通过后原子提交到正式位（同一卷内 rename）。 */
  commit(assetId: string): Promise<void>

  /** 正式位的存储相对引用（本地：sources/<assetId>/source；COS：对象键）。 */
  sourceRef(assetId: string): string

  /** 关键帧落盘目录（持久位，不能落临时区——帧要长期可取）。 */
  framesDir(assetId: string): string

  /** 媒体流与时长校验。 */
  probe(assetId: string): Promise<MediaProbe>

  /** 清掉半成品暂存字节（上传中断、字节数不符）：不动正式位，素材行留着可重试。 */
  discard(assetId: string): Promise<void>

  /** 删掉素材的全部字节（暂存位 + 正式位）：素材行作废时用。 */
  remove(assetId: string): Promise<void>
}
