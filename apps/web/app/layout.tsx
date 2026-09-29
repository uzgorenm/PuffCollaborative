import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Puff · Your project, in view",
  description: "See each person's work, find your session context, and build together.",
  icons: { icon: "/puff-logo.png" },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
