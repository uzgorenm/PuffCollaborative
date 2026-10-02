import { type ComponentProps } from "solid-js"

const cloud = "M8 22a6 6 0 0 1 0-12 8 8 0 0 1 15-3 6 6 0 0 1 7 8 5 5 0 0 1-4 7Z"

export const Mark = (props: { class?: string }) => (
  <svg data-component="logo-mark" class={props.class} viewBox="0 0 32 28" fill="none" aria-hidden="true">
    <path d={cloud} fill="currentColor" />
    <path d="M11 22v4m6-4v5m6-5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg
    ref={props.ref}
    data-component="logo-splash"
    class={props.class}
    viewBox="0 0 32 28"
    fill="none"
    aria-hidden="true"
  >
    <path d={cloud} fill="var(--icon-strong-base)" />
    <path d="M11 22v4m6-4v5m6-5v3" stroke="var(--icon-strong-base)" stroke-width="1.5" stroke-linecap="round" />
  </svg>
)

export const Logo = (props: { class?: string }) => (
  <svg class={props.class} viewBox="0 0 234 42" fill="none" role="img" aria-label="Puff Collab">
    <g transform="translate(1 7)">
      <path d={cloud} fill="var(--icon-strong-base)" />
    </g>
    <text
      x="44"
      y="29"
      fill="var(--icon-strong-base)"
      font-family="system-ui, sans-serif"
      font-size="26"
      font-weight="600"
      letter-spacing="-0.8"
    >
      Puff Collab
    </text>
  </svg>
)
