import type { NextConfig } from "next"
import { resolve } from "node:path"

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  devIndicators: false,
}

export default config
