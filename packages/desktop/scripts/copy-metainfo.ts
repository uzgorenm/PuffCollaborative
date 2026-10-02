import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.opencode.desktop" : `ai.opencode.desktop.${channel}`
const productName =
  channel === "prod" ? "Puff Collab" : `Puff Collab ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `Collaborative AI coding workspace${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ly.anoma">
    <name>Puff Collab contributors</name>
  </developer>

  <description>
    <p>
      Puff Collab provides a shared workspace for AI coding conversations and team activity.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/uzgorenm/PuffCollaborative/issues</url>
  <url type="homepage">https://github.com/uzgorenm/PuffCollaborative</url>
  <url type="vcs-browser">https://github.com/uzgorenm/PuffCollaborative</url>

</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
