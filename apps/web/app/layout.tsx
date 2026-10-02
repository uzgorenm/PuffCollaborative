import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Puff Collab",
  applicationName: "Puff Collab",
  description: "A shared AI coding workspace for projects, conversations, and team activity.",
  icons: { icon: "/puff-collab.svg" },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
