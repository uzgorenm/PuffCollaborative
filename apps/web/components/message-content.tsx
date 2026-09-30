import { useState } from "react"

function Prose(props: { text: string }) {
  return <div className="workflow-message-prose">{props.text.split(/\n\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, position) => part.startsWith("**") ? <strong key={position}>{part.slice(2, -2)}</strong> : part.startsWith("`") ? <code key={position}>{part.slice(1, -1)}</code> : part)}</p>)}</div>
}

function CodeBlock(props: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(props.code); setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 2000) }
    catch { setFailed(true) }
  }
  return <div className="workflow-code"><header><span>{props.language || "Code"}</span><button onClick={copy}>{failed ? "Select code to copy" : copied ? "Copied" : "Copy code"}</button></header><pre><code>{props.code}</code></pre></div>
}

export function MessageContent(props: { text: string }) {
  const chunks = props.text.split(/```([\w+-]*)\n([\s\S]*?)```/g)
  return <>{chunks.map((chunk, index) => index % 3 === 0 ? <Prose key={index} text={chunk} /> : index % 3 === 1 ? <CodeBlock key={index} language={chunk} code={chunks[index + 1].trimEnd()} /> : null)}</>
}
