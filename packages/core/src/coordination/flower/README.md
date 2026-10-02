# Selected Flower input boundary

`captureSelected` creates the `request` and `snapshot` accepted by
`integrations/flower/coordinator.py` from two authorized Puff Threads and their
durable coordination events. Its caller supplies the existing `Access`,
`SessionBinding`, and `Events` services plus a **server-owned current selection**
port. The selection must resolve an owner, exact project/Session/worker, topic,
relationship, expiry and mute state. A shared Thread or project membership alone
is not consent to export. Both selections are checked before and after event
capture. Missing, expired, muted, mismatched or changed selections fail closed.

Only `run.tool` tool name/status from a fixed allowlist and fixed labels for
other content-changing event kinds are exported. The journal's output text,
comment body, instruction text, tool summary, workspace reference and diff
details are never copied. A selected session with no current eligible event
fails rather than fabricating evidence. Up to 20 recent eligible events per
session are included; capture refuses more than 2,000 replayed events per
session. This deliberately limits how much Flower can infer about the actual
task until there is an owner-reviewed per-event text selection workflow.

The Flower adapter's provisional `revision` field receives the exact
project-wide `Event.seq`. It is **not** a per-session revision. The returned
`provenance` sidecar retains `Thread.id`, `Event.id`, `Event.seq` and captured
`Thread.activitySeq` separately for later server validation. Flower's session
revision uses the last selected `Event.seq`; it never compares that value to
`Thread.activitySeq`. The sidecar is
not model input. A caller must revalidate consent, binding, source event and
freshness before submitting remotely and again before storing or delivering
any result; capture cannot make a later remote result authoritative.

The combined product supplies owner cooperation selection, authenticated export,
analysis result registration, and currentness checks through the server's
coordination layer. Those product ports are separate from this low-level capture
helper. See [the Flower setup](../../../../../integrations/flower/README.md).
