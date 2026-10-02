import { useState } from "react"

function Inline(props: { text: string }) {
  return (
    <>
      {props.text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
        if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>
        if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
        if (link)
          return (
            <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          )
        return part
      })}
    </>
  )
}

function Prose(props: { text: string }) {
  return (
    <div className="message-prose">
      {props.text
        .split(/\n\n+/)
        .filter(Boolean)
        .map((paragraph, index) => {
          const lines = paragraph.split("\n")
          if (lines.every((line) => /^\s*[-*] /.test(line)))
            return (
              <ul key={index}>
                {lines.map((line, position) => (
                  <li key={position}>
                    <Inline text={line.replace(/^\s*[-*] /, "")} />
                  </li>
                ))}
              </ul>
            )
          if (lines.every((line) => /^\s*\d+\. /.test(line)))
            return (
              <ol key={index}>
                {lines.map((line, position) => (
                  <li key={position}>
                    <Inline text={line.replace(/^\s*\d+\. /, "")} />
                  </li>
                ))}
              </ol>
            )
          if (/^#{1,6} /.test(paragraph) && lines.length === 1)
            return (
              <h3 key={index}>
                <Inline text={paragraph.replace(/^#{1,6} /, "")} />
              </h3>
            )
          return (
            <p key={index}>
              <Inline text={paragraph} />
            </p>
          )
        })}
    </div>
  )
}

function CodeBlock(props: { language: string; code: string }) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready")
  async function copy() {
    await navigator.clipboard.writeText(props.code).then(
      () => setState("copied"),
      () => setState("failed"),
    )
  }
  return (
    <div className="code-block">
      <header>
        <span>{props.language || "Code"}</span>
        <button onClick={copy} aria-live="polite">
          {state === "failed" ? "Select code to copy" : state === "copied" ? "Copied" : "Copy code"}
        </button>
      </header>
      <pre>
        <code>
          {props.language === "diff"
            ? props.code.split("\n").map((line, index) => (
                <span
                  key={index}
                  className={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : undefined}
                >
                  {line}
                  {"\n"}
                </span>
              ))
            : props.code}
        </code>
      </pre>
    </div>
  )
}

export function MessageContent(props: { text: string }) {
  const blocks = [...props.text.matchAll(/```([\w+-]*)\n([\s\S]*?)(?:```|$)/g)]
  if (!blocks.length) return <Prose text={props.text} />
  return (
    <>
      {blocks.flatMap((block, index) => [
        <Prose
          key={`prose-${index}`}
          text={props.text.slice(index ? blocks[index - 1].index + blocks[index - 1][0].length : 0, block.index)}
        />,
        <CodeBlock key={`code-${index}`} language={block[1]} code={block[2].trimEnd()} />,
      ])}
      <Prose text={props.text.slice(blocks.at(-1)!.index + blocks.at(-1)![0].length)} />
    </>
  )
}
