import type { ProjectSnapshot } from "./project-api"

export type PreviewScenario = "collaboration" | "offline" | "stale" | "failed"

export function previewSnapshot(scenario: PreviewScenario = "collaboration", now = Date.now()): ProjectSnapshot {
  const at = new Date(now - 4_000).toISOString()
  const source = { workerId: "worker-a", sessionId: "compact-nav", eventId: "event-a-4", revision: 4 }
  const target = { workerId: "worker-b", sessionId: "expanded-nav", eventId: "event-b-3", revision: 3 }
  return {
    schemaVersion: 1,
    projectId: "puff-demo",
    projectName: "Navigation explorations",
    viewerId: "serdar",
    workers: [
      { workerId: "worker-a", projectId: "puff-demo", ownerId: "serdar", state: "online", lastSeenAt: at },
      {
        workerId: "worker-b",
        projectId: "puff-demo",
        ownerId: "serdar",
        state: scenario === "offline" ? "offline" : "online",
        lastSeenAt: scenario === "offline" ? new Date(now - 120_000).toISOString() : at,
      },
    ],
    sessions: [
      {
        workerId: "worker-a",
        sessionId: "compact-nav",
        ownerId: "serdar",
        title: "The compact approach",
        featureTopic: "Project navigation",
        relationship: "alternative",
        revision: scenario === "stale" ? 5 : 4,
        status: "running",
      },
      {
        workerId: "worker-b",
        sessionId: "expanded-nav",
        ownerId: "serdar",
        title: "The expanded approach",
        featureTopic: "Project navigation",
        relationship: "alternative",
        revision: 3,
        status: "running",
      },
    ],
    events: [
      {
        ...source,
        projectId: "puff-demo",
        kind: "message",
        occurredAt: at,
        content: {
          role: "assistant",
          text: "Testing the compact navigation. Keyboard users must retain a visible focus target when the sidebar collapses. The focused item currently disappears.",
        },
      },
      {
        ...target,
        projectId: "puff-demo",
        kind: "message",
        occurredAt: at,
        content: {
          role: "assistant",
          text: "Building the expanded navigation with persistent project labels. I will keep a stable focus target when switching layouts; the compact experiment found the same constraint.",
        },
      },
    ],
    summaries: [
      {
        summaryId: "summary-a",
        projectId: "puff-demo",
        workerId: "worker-a",
        sessionId: "compact-nav",
        revision: 4,
        task: "Explore a compact sidebar",
        approach: "Icons first, details on demand. More room for the conversation.",
        workState: "ongoing",
        progress: "Layout implemented. Checking keyboard navigation and focus behavior.",
        blockers: ["Focus disappears when the active item collapses."],
        evidenceRefs: [source],
        generatedAt: at,
        runId: "example-flower-042",
      },
      {
        summaryId: "summary-b",
        projectId: "puff-demo",
        workerId: "worker-b",
        sessionId: "expanded-nav",
        revision: 3,
        task: "Explore a persistent sidebar",
        approach: "Project names stay visible. Fewer steps to switch context.",
        workState: "ongoing",
        progress: "Building the layout with a stable focus target across both modes.",
        blockers: [],
        evidenceRefs: [target],
        generatedAt: at,
        runId: "example-flower-042",
      },
    ],
    awarenessNotes: [
      {
        noteId: "note-focus",
        projectId: "puff-demo",
        sourceWorkerId: "worker-a",
        sourceSessionId: "compact-nav",
        sourceRevision: 4,
        targetWorkerId: "worker-b",
        targetSessionId: "expanded-nav",
        featureTopic: "Project navigation",
        text: "The compact experiment found a shared keyboard constraint: focus must stay visible when the sidebar changes shape. Both approaches are still being explored.",
        evidenceRefs: [source, target],
        state: scenario === "stale" ? "stale" : scenario === "failed" ? "failed" : "delivered",
        runId: "example-flower-042",
      },
      {
        noteId: "note-progress",
        projectId: "puff-demo",
        sourceWorkerId: "worker-b",
        sourceSessionId: "expanded-nav",
        sourceRevision: 3,
        targetWorkerId: "worker-a",
        targetSessionId: "compact-nav",
        featureTopic: "Project navigation",
        text: "The expanded experiment is now testing a stable focus target. This is work in progress, not a chosen implementation.",
        evidenceRefs: [target],
        state: "pending",
        runId: "example-flower-042",
      },
    ],
    proposals: [
      {
        proposalId: "proposal-focus",
        projectId: "puff-demo",
        requestId: "example-request-042",
        kind: "reuse",
        targetWorkerId: "worker-b",
        targetSessionId: "expanded-nav",
        text: "Add a keyboard-focus regression check before comparing the expanded and compact navigation designs. Keep both approaches available for review.",
        rationale:
          "Both experiments change sidebar visibility. One shared acceptance check will make the comparison meaningful without choosing a design prematurely.",
        evidenceRefs: [source, target],
        version: 1,
        state: scenario === "stale" ? "stale" : "proposed",
      },
    ],
    deliveries: [
      {
        deliveryId: "delivery-focus",
        sourceKind: "awarenessNote",
        sourceId: "note-focus",
        targetWorkerId: "worker-b",
        targetSessionId: "expanded-nav",
        messageId: scenario === "failed" ? null : "example-message-017",
        state: scenario === "failed" ? "failed" : "delivered",
        error: scenario === "failed" ? "The worker did not acknowledge the input." : null,
      },
    ],
    decisions: [
      {
        decisionId: "decision-alternatives",
        projectId: "puff-demo",
        text: "Keep the compact and expanded navigation as separate experiments until both have been reviewed.",
        evidenceRefs: [source, target],
        state: "accepted",
        supersedesId: null,
        approvedBy: "serdar",
        approvedAt: at,
      },
    ],
  }
}
