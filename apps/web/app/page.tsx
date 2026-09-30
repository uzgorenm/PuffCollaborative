"use client"

import { useState } from "react"
import DemoWorkspace from "./demo-workspace"
import { LiveWorkspaceView } from "../components/live-workspace"

export default function WorkspacePage() {
  const [demo, setDemo] = useState(false)
  if (demo) return <><button className="live-demo-exit" onClick={() => setDemo(false)}>Return to live workspace</button><DemoWorkspace /></>
  return <LiveWorkspaceView onTryDemo={() => setDemo(true)} />
}
