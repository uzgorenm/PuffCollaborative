import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  devIndicators: false,
}

export default config
