import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Praveen Photography',
  description: 'Capturing your precious moments with artistry and elegance',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
