# Selected analysis input boundary

`captureSelected` creates the `request` and `snapshot` envelope consumed by the
launcher's OpenCode analysis agent (`script/runtime/analysis.ts`) from two
authorized Puff Threads and their durable coordination events. Its caller
supplies the existing `Access`, `SessionBinding`, and `Events` services plus a
**server-owned current selection** port. The selection must resolve an owner,
exact project/Session/worker, topic, relationship, expiry and mute state. A
shared Thread or project membership alone is not consent to export. Both
selections are checked before and after event capture. Missing, expired, muted,
mismatched or changed selections fail closed.

Only `run.tool` tool name/status from a fixed allowlist and fixed labels for
other content-changing event kinds are exported. The journal's output text,
comment body, instruction text, tool summary, workspace reference and diff
details are never copied unless the owner separately enabled bounded, redacted
instruction/output text. A selected session with no current eligible event
fails rather than fabricating evidence. Up to 20 recent eligible events per
session are included; capture refuses more than 2,000 replayed events per
session.

The snapshot's `revision` field receives the exact project-wide `Event.seq`. It
is **not** a per-session revision. The returned `provenance` sidecar retains
`Thread.id`, `Event.id`, `Event.seq` and captured `Thread.activitySeq`
separately for later server validation. The sidecar is not model input. A
caller must revalidate consent, binding, source event and freshness before
running analysis and again before storing or delivering any result; capture
cannot make a later model result authoritative.

`results.ts` registers analysis results from the `analysis` service principal,
revalidates every cited event and current consent, and admits informational
awareness notes into the target Session only through its verified owner.
