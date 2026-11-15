import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'trend-suite',
  description: '趋势套件云端服务',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
