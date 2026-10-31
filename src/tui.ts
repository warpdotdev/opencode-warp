import { createRequire } from "node:module"
import path from "node:path"
import type {
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { buildPayload } from "./payload.js"
import { warpNotify } from "./notify.js"
import { extractTextFromParts, truncate } from "./utils.js"

// Resolves to the package root from both src/ and dist/; npm always ships package.json.
const PLUGIN_VERSION: string = createRequire(import.meta.url)(
  "../package.json",
).version

const REQUEST_TIMEOUT_MS = 2_000
const MAX_SEEN_EVENTS = 512

type SessionEvent = Extract<
  OpenCodeEvent,
  {
    type:
      | "session.created"
      | "session.deleted"
      | "session.moved"
      | "session.inbox.enqueued"
      | "session.inbox.delivered"
      | "session.inbox.cancelled"
      | "session.execution.succeeded"
      | "session.execution.failed"
      | "session.execution.interrupted"
      | "permission.asked"
      | "permission.replied"
      | "form.created"
      | "session.tool.input.started"
      | "session.tool.success"
      | "session.tool.failed"
  }
>

type NotificationSession = Pick<
  SessionInfo,
  "id" | "parentID" | "location" | "subpath"
>
type Summary = { query: string; response: string }
type SessionState = {
  controller: AbortController
  pending: Promise<void>
  info?: NotificationSession
  announced: boolean
  query?: string
  inbox: Map<string, string | undefined>
  tools: Map<string, string>
  completed: Set<string>
  seen: Set<string>
}

function isSessionEvent(event: OpenCodeEvent): event is SessionEvent {
  switch (event.type) {
    case "session.created":
    case "session.deleted":
    case "session.moved":
    case "session.inbox.enqueued":
    case "session.inbox.delivered":
    case "session.inbox.cancelled":
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "permission.asked":
    case "permission.replied":
    case "form.created":
    case "session.tool.input.started":
    case "session.tool.success":
    case "session.tool.failed":
      return true
    default:
      return false
  }
}

function summarize(
  messages: readonly SessionMessageInfo[],
  before: number,
): Summary {
  const history = messages
    .filter((message) => message.time.created <= before)
    .reverse()
  const user = history.find((message) => message.type === "user")
  const assistant = history.find((message) => message.type === "assistant")
  return {
    query: user?.type === "user" ? user.text : "",
    response:
      assistant?.type === "assistant"
        ? extractTextFromParts(assistant.content)
        : "",
  }
}

export default {
  id: "opencode-warp.cli",
  setup(ctx) {
    if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
      console.warn(
        "⚠️ Detected unsupported Warp version. Please update Warp to use this plugin.",
      )
      return
    }

    const controller = new AbortController()
    const sessions = new Map<string, SessionState>()

    function ownsSession(sessionID: string) {
      const route = ctx.ui.router.current()
      if (
        route.type === "session" &&
        ctx.data.session.root(route.sessionID) === sessionID
      )
        return true
      return (
        ctx.ui.tabs.enabled() &&
        ctx.ui.tabs.list().some((tab) => tab.sessionID === sessionID)
      )
    }

    function stateFor(sessionID: string) {
      let state = sessions.get(sessionID)
      if (!state) {
        state = {
          controller: new AbortController(),
          pending: Promise.resolve(),
          announced: false,
          inbox: new Map(),
          tools: new Map(),
          completed: new Set(),
          seen: new Set(),
        }
        for (const item of ctx.data.session.pending.list(sessionID)) {
          state.inbox.set(
            item.id,
            item.type === "user" ? item.payload.text : undefined,
          )
        }
        sessions.set(sessionID, state)
      }
      return state
    }

    async function request<T>(
      state: SessionState,
      run: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      const signal = AbortSignal.any([
        controller.signal,
        state.controller.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ])
      signal.throwIfAborted()
      let abort = () => {}
      const aborted = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        if (signal.aborted) abort()
        else signal.addEventListener("abort", abort, { once: true })
      })
      try {
        return await Promise.race([aborted, run(signal)])
      } finally {
        signal.removeEventListener("abort", abort)
      }
    }

    function notify(
      state: SessionState,
      info: NotificationSession,
      event: string,
      fields: Record<string, unknown> = {},
    ) {
      if (
        controller.signal.aborted ||
        state.controller.signal.aborted ||
        !ownsSession(info.id)
      )
        return
      const paths = info.location.directory.startsWith("/")
        ? path.posix
        : path.win32
      const cwd = info.subpath
        ? paths.join(info.location.directory, info.subpath)
        : info.location.directory
      if (!state.announced) {
        warpNotify(
          "warp://cli-agent",
          buildPayload("session_start", info.id, cwd, {
            plugin_version: PLUGIN_VERSION,
          }),
        )
        state.announced = true
      }
      if (event !== "session_start")
        warpNotify(
          "warp://cli-agent",
          buildPayload(event, info.id, cwd, fields),
        )
    }

    async function handle(
      event: SessionEvent,
      sessionID: string,
      state: SessionState,
      snapshot?: Summary,
    ) {
      if (
        controller.signal.aborted ||
        state.controller.signal.aborted ||
        !ownsSession(sessionID)
      )
        return
      if (event.type === "session.deleted") {
        state.controller.abort()
        sessions.delete(sessionID)
        return
      }
      if (event.type === "session.moved") {
        state.info = undefined
        return
      }
      if (
        ctx.location &&
        event.location &&
        (ctx.location.directory !== event.location.directory ||
          ctx.location.workspaceID !== event.location.workspaceID)
      )
        return
      if (event.type === "session.inbox.enqueued") {
        state.inbox.set(
          event.data.inboxID,
          event.data.item.type === "user"
            ? event.data.item.payload.text
            : undefined,
        )
        return
      }
      if (event.type === "session.inbox.cancelled") {
        state.inbox.delete(event.data.inboxID)
        return
      }

      let info = ctx.data.session.get(sessionID) ?? state.info
      if (event.type === "session.created") {
        info = {
          id: sessionID,
          parentID: event.data.parentID,
          location: event.data.location,
          subpath: event.data.subpath,
        }
      }
      if (!info) {
        try {
          info = await request(state, (signal) =>
            ctx.client.session.get({ sessionID }, { signal }),
          )
        } catch {
          return
        }
      }
      state.info = info
      if (
        info.parentID ||
        (ctx.location && info.location.directory !== ctx.location.directory)
      )
        return

      switch (event.type) {
        case "session.created":
          notify(state, info, "session_start")
          return
        case "session.inbox.delivered": {
          const query = state.inbox.get(event.data.inboxID)
          state.inbox.delete(event.data.inboxID)
          if (query !== undefined) {
            state.query = query
            notify(state, info, "prompt_submit", {
              query: truncate(query, 200),
            })
          }
          return
        }
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted": {
          if (
            event.type === "session.execution.interrupted" &&
            event.data.reason === "superseded"
          )
            return
          let summary = snapshot ?? { query: "", response: "" }
          if (!snapshot) {
            try {
              const messages = await request(state, (signal) =>
                ctx.client.session.context({ sessionID }, { signal }),
              )
              summary = summarize(messages, event.created)
            } catch {
              // Status updates must not depend on successful history retrieval.
            }
          }
          notify(state, info, "stop", {
            query: truncate(state.query ?? summary.query, 200),
            response: truncate(summary.response, 200),
            transcript_path: "",
          })
          state.tools.clear()
          state.completed.clear()
          return
        }
        case "permission.asked": {
          const { action, resources, metadata = {}, message } = event.data
          const preview = resources.join(", ")
          notify(state, info, "permission_request", {
            summary: truncate(
              message ||
                `Wants to run ${action}${preview ? `: ${preview}` : ""}`,
              200,
            ),
            tool_name: action,
            tool_input: metadata,
          })
          return
        }
        case "permission.replied":
          if (event.data.reply !== "reject")
            notify(state, info, "permission_replied")
          return
        case "form.created":
          notify(state, info, "question_asked", { tool_name: "question" })
          return
        case "session.tool.input.started":
          state.tools.set(
            `${event.data.assistantMessageID}:${event.data.id}`,
            event.data.name,
          )
          return
        case "session.tool.success":
        case "session.tool.failed": {
          const key = `${event.data.assistantMessageID}:${event.data.id}`
          if (state.completed.has(key)) return
          state.completed.add(key)
          const message = ctx.data.session.message.get(
            sessionID,
            event.data.assistantMessageID,
          )
          const content =
            message?.type === "assistant"
              ? message.content.find(
                  (part) => part.type === "tool" && part.id === event.data.id,
                )
              : undefined
          const name =
            state.tools.get(key) ??
            (content?.type === "tool" ? content.name : "unknown")
          notify(state, info, "tool_complete", { tool_name: name })
          state.tools.delete(key)
          return
        }
      }
    }

    const unsubscribe = ctx.data.listen(({ details: event }) => {
      if (!isSessionEvent(event) || controller.signal.aborted) return
      for (const [id, state] of sessions) {
        if (ownsSession(id)) continue
        state.controller.abort()
        sessions.delete(id)
      }
      const sessionID =
        event.type === "form.created"
          ? event.data.form.sessionID
          : event.data.sessionID
      if (!ownsSession(sessionID)) return
      const state = stateFor(sessionID)
      if (state.seen.has(event.id)) return
      state.seen.add(event.id)
      if (state.seen.size > MAX_SEEN_EVENTS)
        state.seen.delete(state.seen.values().next().value!)

      let snapshot: Summary | undefined
      if (event.type.startsWith("session.execution.")) {
        const messages = ctx.data.session.message.list(sessionID)
        if (messages.length) snapshot = summarize(messages, event.created)
      }
      // Keep each session ordered without blocking another tab's permission notifications.
      state.pending = state.pending
        .then(() => handle(event, sessionID, state, snapshot))
        .catch((error) => {
          console.error("[opencode-warp] failed to process CLI event:", error)
        })
    })
    return () => {
      controller.abort()
      unsubscribe()
      sessions.clear()
    }
  },
} satisfies Plugin.Definition
