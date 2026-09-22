import { describe, it, expect, afterEach } from "bun:test"
import { attachWarp, HANDSHAKE_DELAY_MS, type V2Context, type V2Event, type V2Message, type V2Session } from "../src/v2"

interface Harness {
  emit(type: string, data?: Record<string, any>): void
  sent(): Array<Record<string, any>>
  cleanup: () => void
}

function makeHarness(
  opts: {
    route?: { type: string; sessionID?: string }
    tabs?: string[]
    sessions?: Record<string, Partial<V2Session>>
    messages?: Record<string, V2Message[]>
  } = {},
): Harness {
  const bodies: string[] = []
  let handler: (event: { details: V2Event }) => void = () => {}
  const sessions = opts.sessions ?? {}
  const context: V2Context = {
    location: { directory: "/home/user/proj" },
    data: {
      listen(h) {
        handler = h
        return () => {
          handler = () => {}
        }
      },
      session: {
        list: () => Object.entries(sessions).map(([id, s]) => ({ id, ...s })),
        get: (id) => (sessions[id] ? { id, ...sessions[id] } : undefined),
        root: (id) => sessions[id]?.parentID ?? id,
        message: {
          list: (id) => opts.messages?.[id] ?? [],
          sync: async () => {},
        },
      },
    },
    ui: {
      router: { current: () => opts.route ?? { type: "session", sessionID: "s1" } },
      tabs: {
        enabled: () => opts.tabs !== undefined,
        list: () => (opts.tabs ?? []).map((sessionID) => ({ sessionID })),
      },
    },
  }
  const cleanup = attachWarp(context, (body) => bodies.push(body))
  return {
    emit: (type, data = {}) => handler({ details: { type, data } }),
    sent: () => bodies.map((b) => JSON.parse(b)),
    cleanup,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("attachWarp (OpenCode 2)", () => {
  let harness: Harness | undefined

  afterEach(() => {
    harness?.cleanup()
    harness = undefined
  })

  it("sends session_start before the first event for a session", () => {
    harness = makeHarness()
    harness.emit("permission.asked", { sessionID: "s1", action: "bash", metadata: { command: "ls" } })
    const events = harness.sent().map((p) => p.event)
    expect(events).toEqual(["session_start", "permission_request"])
    expect(harness.sent()[0].plugin_version).toBeString()
  })

  it("builds permission_request from the v2 permission payload", () => {
    harness = makeHarness()
    harness.emit("permission.asked", {
      sessionID: "s1",
      action: "bash",
      resources: ["ls -la"],
      metadata: { command: "ls -la" },
    })
    const payload = harness.sent()[1]
    expect(payload.summary).toBe("Wants to run bash: ls -la")
    expect(payload.tool_name).toBe("bash")
    expect(payload.tool_input).toEqual({ command: "ls -la" })
  })

  it("falls back to resources for the permission preview", () => {
    harness = makeHarness()
    harness.emit("permission.asked", { sessionID: "s1", action: "edit", resources: ["src/a.ts"] })
    expect(harness.sent()[1].summary).toBe("Wants to run edit: src/a.ts")
  })

  it("skips rejected permission replies", () => {
    harness = makeHarness()
    harness.emit("permission.replied", { sessionID: "s1", reply: "reject" })
    harness.emit("permission.replied", { sessionID: "s1", reply: "once" })
    expect(harness.sent().map((p) => p.event)).toEqual(["session_start", "permission_replied"])
  })

  it("names the tool on tool_complete", () => {
    harness = makeHarness()
    harness.emit("session.tool.input.started", { sessionID: "s1", id: "t1", name: "bash" })
    harness.emit("session.tool.success", { sessionID: "s1", id: "t1" })
    expect(harness.sent()[1]).toMatchObject({ event: "tool_complete", tool_name: "bash" })
  })

  it("sends question_asked for forms", () => {
    harness = makeHarness()
    harness.emit("form.created", { form: { id: "f1", sessionID: "s1" } })
    expect(harness.sent()[1]).toMatchObject({ event: "question_asked", session_id: "s1" })
  })

  it("sends prompt_submit and a single stop per turn", async () => {
    harness = makeHarness({
      messages: {
        s1: [
          { type: "user", text: "fix the bug", time: { created: 1 } },
          {
            type: "assistant",
            content: [
              { type: "tool" },
              { type: "text", text: "Fixed it." },
            ],
            time: { created: 2 },
          },
        ],
      },
    })
    harness.emit("session.execution.started", { sessionID: "s1" })
    await flush()
    harness.emit("session.execution.succeeded", { sessionID: "s1" })
    harness.emit("session.idle", { sessionID: "s1" })
    await flush()
    const sent = harness.sent()
    expect(sent.map((p) => p.event)).toEqual(["session_start", "prompt_submit", "stop"])
    expect(sent[1].query).toBe("fix the bug")
    expect(sent[2]).toMatchObject({ query: "fix the bug", response: "Fixed it." })
  })

  it("ignores subagent sessions", () => {
    harness = makeHarness({ sessions: { s1: {}, child: { parentID: "s1" } } })
    harness.emit("permission.asked", { sessionID: "child", action: "bash" })
    expect(harness.sent()).toEqual([])
  })

  it("ignores sessions shown by other clients", () => {
    harness = makeHarness({ route: { type: "session", sessionID: "s1" } })
    harness.emit("permission.asked", { sessionID: "elsewhere", action: "bash" })
    expect(harness.sent()).toEqual([])
  })

  it("accepts sessions open in a background tab", () => {
    harness = makeHarness({ route: { type: "session", sessionID: "s1" }, tabs: ["s1", "s2"] })
    harness.emit("permission.asked", { sessionID: "s2", action: "bash" })
    expect(harness.sent().map((p) => p.session_id)).toEqual(["s2", "s2"])
  })

  it("sends the session_start handshake at launch without any events", async () => {
    harness = makeHarness({
      route: { type: "home" },
      sessions: {
        old: { time: { updated: 1 }, location: { directory: "/home/user/proj" } },
        recent: { time: { updated: 5 }, location: { directory: "/home/user/proj" } },
        other: { time: { updated: 9 }, location: { directory: "/elsewhere" } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_DELAY_MS + 100))
    expect(harness.sent()).toHaveLength(1)
    expect(harness.sent()[0]).toMatchObject({ event: "session_start", session_id: "recent" })
  })

  it("does not repeat the launch handshake after session_start was sent", async () => {
    harness = makeHarness()
    harness.emit("permission.asked", { sessionID: "s1", action: "bash" })
    await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_DELAY_MS + 100))
    expect(harness.sent().filter((p) => p.event === "session_start")).toHaveLength(1)
  })
})

describe("tui entrypoint", () => {
  it("exports a v2 plugin definition", async () => {
    const { default: plugin } = await import("../src/tui")
    expect(plugin.id).toBe("warp")
    expect(typeof plugin.setup).toBe("function")
  })
})
