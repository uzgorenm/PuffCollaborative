"use client"

import { useState } from "react"
import type { Session } from "../lib/sessions"
import "./project-overview.css"

export type ProjectOverviewProps = {
  project: {
    name: string
    goal: string
    members: { name: string; initials: string; color: string; focus: string }[]
  }
  sessions: (Session & { task?: string; scope?: "project" | "private"; topic?: string; relation?: string })[]
  onOpenSession: (id: string) => void
  onNewSession: () => void
  onSetup: () => void
  onStartScenario: (scenario: "overlap" | "solution" | "solo") => void
  onReset: () => void
  onUndoReset?: () => void
}

const statusLabels = { running: "Working", waiting: "Ready", complete: "Completed" }

export function ProjectOverview(props: ProjectOverviewProps) {
  const [person, setPerson] = useState("all")
  const sessions = props.sessions.filter(session => session.scope !== "private" || session.owner === "You")
  const members = props.project.members.filter(member => person === "all" || member.name === person)
  const visibleSessions = sessions.filter(session => members.some(member => member.name === session.owner))

  return <div className="project-overview">
    <header className="overview-header">
      <div className="overview-heading">
        <div className="overview-project-name">{props.project.name}</div>
        <h1>Project overview</h1>
        <p className="overview-goal">{props.project.goal}</p>
      </div>
      <div className="overview-actions">
        <div className="overview-action-buttons">
          <button type="button" className="overview-settings" onClick={props.onSetup}>Project settings</button>
          <button type="button" className="overview-new-session" onClick={props.onNewSession}><span aria-hidden="true">+</span> New session</button>
        </div>
        <div className="overview-reset-actions">
          {props.onUndoReset && <button type="button" onClick={props.onUndoReset}>Undo reset</button>}
          <button type="button" onClick={props.onReset}>Reset workspace</button>
        </div>
      </div>
    </header>

    <nav className="overview-workflows" aria-label="Project workflows">
      <span className="overview-workflows-label">Try a workflow</span>
      <button type="button" onClick={() => props.onStartScenario("overlap")}>Avoid duplicate work<span aria-hidden="true">↗</span></button>
      <button type="button" onClick={() => props.onStartScenario("solution")}>Reuse a solved problem<span aria-hidden="true">↗</span></button>
      <button type="button" onClick={() => props.onStartScenario("solo")}>Find my context<span aria-hidden="true">↗</span></button>
    </nav>

    <section className="overview-team" aria-labelledby="overview-team-heading">
      <div className="overview-team-heading">
        <div>
          <h2 id="overview-team-heading">People &amp; their work</h2>
          <span className="overview-team-count">{members.length} {members.length === 1 ? "person" : "people"}<span aria-hidden="true"> · </span>{visibleSessions.length} {visibleSessions.length === 1 ? "session" : "sessions"}</span>
        </div>
        <label className="overview-filter">
          <span>Show</span>
          <select aria-label="Filter people" value={person} onChange={event => setPerson(event.target.value)}>
            <option value="all">All people</option>
            <option value="You">My work</option>
            {props.project.members.filter(member => member.name !== "You").map(member => <option key={member.name} value={member.name}>{member.name}</option>)}
          </select>
        </label>
      </div>

      <div className="overview-people-grid">
        {members.map(member => {
          const owned = sessions.filter(session => session.owner === member.name)
          const working = owned.filter(session => session.status === "running")
          const ready = owned.filter(session => session.status === "waiting")
          const completed = owned.filter(session => session.status === "complete")
          const added = owned.filter(session => !["demo-you-api", "demo-you-auth", "demo-sam-frontend", "demo-sam-mobile", "demo-alice-server", "demo-alice-tests"].includes(session.id)).map(session => session.task || session.title)

          return <article className="overview-person-card" key={member.name} aria-label={`${member.name}'s work`}>
            <header className="overview-person-header">
              <span className={`overview-avatar ${member.color}`} aria-hidden="true">{member.initials}</span>
              <h3>{member.name === "You" ? "Serdar (you)" : member.name}</h3>
              <span className="overview-session-count">{owned.length} {owned.length === 1 ? "session" : "sessions"}</span>
            </header>

            <div className="overview-person-summary">
              <div className="overview-summary-label">Total work</div>
              <p>{member.focus}{added.length > 0 && ` Also: ${added.join("; ")}.`}</p>
              <div className="overview-work-counts">
                <span className={working.length ? "has-working" : ""}><span className="overview-status-dot running" aria-hidden="true" />{working.length} working</span>
                {ready.length > 0 && <span>{ready.length} ready</span>}
                <span>{completed.length} completed</span>
              </div>
            </div>

            <div className="overview-person-sessions">
              <div className="overview-sessions-label">Sessions</div>
              {owned.map((session, index) => <button type="button" className="overview-session-row" key={session.id} aria-label={sessions.filter(item => item.title === session.title).length > 1 ? `Open ${session.title}, ${member.name}'s session ${index + 1}` : `Open ${session.title}`} onClick={() => props.onOpenSession(session.id)}>
                <span className="overview-session-meta">
                  <span className={`overview-session-status ${session.status}`}><span className={`overview-status-dot ${session.status}`} aria-hidden="true" />{statusLabels[session.status]}</span>
                  {session.scope === "private" && <span className="overview-private"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.4" /><path d="M5 7V4a3 3 0 0 1 6 0v3" /></svg>Private</span>}
                </span>
                <span className="overview-session-title">{session.title}<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" /></svg></span>
                <span className="overview-session-summary" title={session.summary}>{session.summary || session.task || "Open this session to review its context."}</span>
                {session.relation && <span className="overview-session-relation">{session.relation.replace(/\s*\(demo-[^)]+\)/g, "")}</span>}
              </button>)}
              {!owned.length && <p className="overview-person-empty">{member.name === "You" ? "Start a session to bring your work into view." : `${member.name}'s shared sessions will appear here.`}</p>}
            </div>
          </article>
        })}
      </div>
      {!members.length && <p className="overview-empty">No people match this view. Choose All people to see the project team.</p>}
    </section>
  </div>
}
