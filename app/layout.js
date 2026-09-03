import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import LayoutClient from './layout-client'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'SeguiTrack',
  description: 'Sistema de Seguimiento de Órdenes de Trabajo',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className}>
        <Script id="theme-init" strategy="beforeInteractive">{`
          (function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()
        `}</Script>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  )
}