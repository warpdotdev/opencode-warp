import { buildPayload } from "./payload"
import { truncate } from "./utils"
import { PLUGIN_VERSION } from "./constants"

// Warp integration for OpenCode 2.
//
// OpenCode 2 runs server plugins (opencode.json "plugins") inside a shared
// background service that has no terminal, so they cannot reach Warp. This
// runs as a CLI plugin (cli.json "plugins", loaded through the "./tui"
// export) in the opencode process attached to the Warp pane instead.
//
// The event bus is shared by every client attached to that service, so each
// event is checked against the sessions this client is actually showing.

// The subset of the OpenCode 2 CLI plugin context this integration uses.
// Declared locally to avoid a dependency on @opencode/plugin.
export interface V2Event {
  type: string
  data?: Record<string, any>
}

export interface V2Session {
  id: string
  parentID?: string
  time?: { created?: number; updated?: number }
  location?: { directory?: string }
}

export interface V2Message {
  type: string
  text?: string
  content?: Array<{ type: string; text?: string }>
  time?: { created?: number }
}

export interface V2Context {
  location?: { directory?: string }
  data: {
    listen(handler: (event: { details: V2Event }) => void): () => void
    session: {
      list(): V2Session[] | undefined
      get(sessionID: string): V2Session | undefined
      root(sessionID: string): string
      message: {
        list(sessionID: string): V2Message[] | undefined
        sync(sessionID: string): Promise<void>
      }
    }
  }
  ui: {
    router: {
      current(): { type: string; sessionID?: string }
    }
    tabs?: {
      enabled(): boolean
      list(): ReadonlyArray<{ sessionID: string }>
    }
  }
}

// Warp keeps showing its "install the plugin" chip until it receives a
// session_start handshake, and it checks around launch — before the user
// has sent a prompt — so send one shortly after startup.
export const HANDSHAKE_DELAY_MS = 1000

interface PermissionAsked {
  sessionID: string
  action?: string
  resources?: string[]
  metadata?: Record<string, unknown>
}

function permissionFields(data: PermissionAsked) {
  const toolName = data.action || "unknown"
  const metadata = data.metadata || {}

  let toolPreview = ""
  if (typeof metadata.command === "string") {
    toolPreview = metadata.command
  } else if (typeof metadata.file_path === "string") {
    toolPreview = metadata.file_path
  } else if (typeof metadata.filePath === "string") {
    toolPreview = metadata.filePath
  } else if (data.resources?.length) {
    toolPreview = data.resources.join(", ")
  } else {
    toolPreview = JSON.stringify(metadata).slice(0, 80)
  }

  let summary = `Wants to run ${toolName}`
  if (toolPreview) {
    summary += `: ${truncate(toolPreview, 120)}`
  }

  return { summary, tool_name: toolName, tool_input: metadata }
}

function lastOfType(messages: V2Message[], type: string) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === type) return messages[i]
  }
  return undefined
}

function assistantText(message: V2Message | undefined): string {
  return (message?.content ?? [])
    .filter((c) => c.type === "text" && Boolean(c.text))
    .map((c) => c.text)
    .join(" ")
}

/**
 * Subscribe to OpenCode 2 events and forward them to Warp through `notify`.
 * Returns a cleanup function.
 */
export function attachWarp(
  context: V2Context,
  notify: (body: string) => void,
): () => void {
  const started = new Set<string>() // sessions that have had session_start
  const busy = new Set<string>() // sessions with a turn in flight
  const toolNames = new Map<string, string>() // tool call id -> tool name

  function info(sessionID: string) {
    try {
      return context.data.session.get(sessionID)
    } catch {
      return undefined
    }
  }

  function isSubagent(sessionID: string) {
    return Boolean(info(sessionID)?.parentID)
  }

  // True when this client is showing the session (or its root session).
  function isShown(sessionID: string | undefined): sessionID is string {
    if (!sessionID) return false
    let root = sessionID
    try {
      root = context.data.session.root(sessionID) || sessionID
    } catch {}
    try {
      const route = context.ui.router.current()
      if (
        route?.type === "session" &&
        (route.sessionID === root || route.sessionID === sessionID)
      ) {
        return true
      }
    } catch {}
    try {
      const tabs = context.ui.tabs
      if (tabs?.enabled() && tabs.list().some((t) => t.sessionID === root)) {
        return true
      }
    } catch {}
    return false
  }

  function cwdFor(sessionID: string) {
    return info(sessionID)?.location?.directory || context.location?.directory || ""
  }

  function handshake(sessionID: string) {
    started.add(sessionID)
    notify(
      buildPayload("session_start", sessionID, cwdFor(sessionID), {
        plugin_version: PLUGIN_VERSION,
      }),
    )
  }

  function send(
    sessionID: string | undefined,
    event: string,
    extraFields: Record<string, unknown> = {},
  ) {
    if (!isShown(sessionID) || isSubagent(sessionID)) return
    // The client may not be showing a session yet when session.created
    // fires, so session_start is sent on first contact instead.
    if (!started.has(sessionID)) handshake(sessionID)
    notify(buildPayload(event, sessionID, cwdFor(sessionID), extraFields))
  }

  async function messages(sessionID: string): Promise<V2Message[]> {
    try {
      await context.data.session.message.sync(sessionID)
    } catch {}
    try {
      return [...(context.data.session.message.list(sessionID) ?? [])].sort(
        (a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0),
      )
    } catch {
      return []
    }
  }

  async function promptSubmitted(sessionID: string | undefined) {
    if (!isShown(sessionID) || isSubagent(sessionID)) return
    const query = lastOfType(await messages(sessionID), "user")?.text ?? ""
    if (!query) return
    send(sessionID, "prompt_submit", { query: truncate(query, 200) })
  }

  async function stopped(sessionID: string | undefined) {
    if (!isShown(sessionID) || isSubagent(sessionID)) return
    const list = await messages(sessionID)
    send(sessionID, "stop", {
      query: truncate(lastOfType(list, "user")?.text ?? "", 200),
      response: truncate(assistantText(lastOfType(list, "assistant")), 200),
      transcript_path: "",
    })
  }

  const handshakeTimer = setTimeout(() => {
    if (started.size > 0) return
    let sessionID: string | undefined
    try {
      const route = context.ui.router.current()
      if (route?.type === "session") sessionID = route.sessionID
    } catch {}
    if (!sessionID) {
      try {
        const dir = context.location?.directory
        sessionID = (context.data.session.list() ?? [])
          .filter((s) => !s.parentID && (!dir || s.location?.directory === dir))
          .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))[0]?.id
      } catch {}
    }
    handshake(sessionID ?? "")
  }, HANDSHAKE_DELAY_MS)

  const stopListening = context.data.listen(({ details }) => {
    const event = details ?? { type: "" }
    const data = event.data ?? {}
    const sessionID: string | undefined = data.sessionID ?? data.form?.sessionID

    switch (event.type) {
      case "session.execution.started":
        if (sessionID) busy.add(sessionID)
        void promptSubmitted(sessionID)
        return
      // A finished turn is reported both as an execution result and as
      // session.idle; notify once.
      case "session.execution.succeeded":
      case "session.execution.interrupted":
      case "session.execution.failed":
      case "session.idle":
        if (sessionID && busy.delete(sessionID)) void stopped(sessionID)
        return
      case "session.tool.input.started":
        toolNames.set(data.id, data.name)
        return
      case "session.tool.success":
      case "session.tool.failed": {
        const toolName = toolNames.get(data.id) ?? "unknown"
        toolNames.delete(data.id)
        send(sessionID, "tool_complete", { tool_name: toolName })
        return
      }
      case "permission.asked":
        send(sessionID, "permission_request", permissionFields(data as PermissionAsked))
        return
      case "permission.replied":
        if (data.reply !== "reject") send(sessionID, "permission_replied")
        return
      // OpenCode 2 asks the user questions through forms rather than the
      // OpenCode 1 "question" tool.
      case "form.created":
        send(sessionID, "question_asked", { tool_name: "question" })
        return
      case "session.deleted":
        if (sessionID) {
          started.delete(sessionID)
          busy.delete(sessionID)
        }
        return
    }
  })

  return () => {
    clearTimeout(handshakeTimer)
    stopListening()
  }
}
