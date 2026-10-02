"use client"

import { useState } from "react"
import type { LiveWorkspace, LiveSession } from "../lib/live-workspace"

export function ProjectOverview(props: {
  project: LiveWorkspace["workspace"]["project"]
  sessions: LiveSession[]
  actorName: string
  onOpenSession: (id: string) => void
  onNewSession: () => void
  onSetup: () => void
}) {
  const [person, setPerson] = useState("all")
  const members = props.project.members.filter((member) => person === "all" || member.name === person)

  return (
    <div className="project-overview">
      <header className="overview-header">
        <div>
          <h1>Shared work</h1>
          <p>{props.project.goal}</p>
        </div>
        {props.sessions.length > 0 && (
          <button className="primary-button" onClick={props.onNewSession}>
            New thread <span aria-hidden="true">+</span>
          </button>
        )}
      </header>
      <div className="section-heading">
        <h2>
          Team work <span>{props.sessions.length} shared threads</span>
        </h2>
        <label className="person-filter">
          Show
          <select aria-label="Filter people" value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="all">Everyone</option>
            {props.project.members.map((member) => (
              <option key={member.name} value={member.name}>
                {member.name === "You" ? "My work" : member.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overview-people">
        {members.map((member) => {
          const owned = props.sessions.filter((session) => session.owner === member.name)
          return (
            <section
              className="overview-person"
              key={member.name}
              aria-label={`${member.name === "You" ? props.actorName : member.name}'s work`}
            >
              <header>
                <span className={`avatar ${member.color}`} aria-hidden="true">
                  {member.name === "You" ? props.actorName[0] : member.initials}
                </span>
                <h3>{member.name === "You" ? `${props.actorName} (you)` : member.name}</h3>
                <span>
                  {owned.length} {owned.length === 1 ? "thread" : "threads"}
                </span>
              </header>
              {member.focus !== "No stated focus." && <p className="member-focus">Focus: {member.focus}</p>}
              {owned.map((session) => (
                <button
                  className="overview-thread"
                  key={session.id}
                  onClick={() => props.onOpenSession(session.id)}
                  aria-label={`Open ${session.title}, ${member.name === "You" ? props.actorName : member.name}'s thread`}
                >
                  <span className="overview-thread-title">
                    <i className={`status-dot ${session.status}`} aria-hidden="true" />
                    {session.title}
                  </span>
                  <span className="execution-label">
                    {session.execution === "unknown" ? "No run yet" : session.execution.replaceAll("_", " ")}
                  </span>
                  <span className="overview-thread-summary">
                    {session.freshness === "missing" ? "No activity summary yet." : session.summary}
                  </span>
                  {session.freshness === "stale" && <span className="summary-age">Summary may be out of date</span>}
                </button>
              ))}
              {!owned.length && <p className="empty-inline">No shared threads yet.</p>}
            </section>
          )
        })}
      </div>
      {!props.sessions.length && (
        <div className="overview-empty">
          <h2>Start the first conversation</h2>
          <p>Create a shared thread for your task. Teammates can follow the agent's work and contribute comments.</p>
          <button onClick={props.onNewSession}>Create a thread</button>
        </div>
      )}
      <button className="text-button" onClick={props.onSetup}>
        Edit project brief
      </button>
    </div>
  )
}
