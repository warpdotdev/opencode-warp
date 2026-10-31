import { describe, it, afterEach, mock, spyOn } from "bun:test"
import { expect } from "bun:test"
import fs from "fs"
import type {
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"

const writeSpy = mock(() => {})
mock.module("fs", () => ({
  ...fs,
  writeFileSync: writeSpy,
}))

const { warpNotify } = await import("../src/notify")
const { default: tui } = await import("../src/tui")

describe("warpNotify", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION

  afterEach(() => {
    writeSpy.mockClear()
    if (originalVersion === undefined) {
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    } else {
      process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
    }
  })

  it("skips when WARP_CLI_AGENT_PROTOCOL_VERSION is not set", () => {
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    warpNotify("title", "body")
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("writes OSC 777 sequence when Warp declares protocol support", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    warpNotify("warp://cli-agent", '{"event":"stop"}')
    expect(writeSpy).toHaveBeenCalledTimes(1)

    const [path, data] = writeSpy.mock.calls[0] as [string, string]
    expect(path).toBe("/dev/tty")
    expect(data).toContain("warp://cli-agent")
    expect(data).toContain('{"event":"stop"}')
    expect(data).toMatch(/^\x1b\]777;notify;/)
    expect(data).toMatch(/\x07$/)
  })
})

describe("OpenCode V2 plugin", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
  const cleanups: Array<() => void> = []
  const session = {
    id: "s1",
    location: { directory: "/project" },
  } as SessionInfo

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    mock.restore()
    writeSpy.mockClear()
    if (originalVersion === undefined)
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    else process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
  })

  function harness(
    options: {
      parentID?: string
      cached?: boolean
      failHistory?: boolean
      failSession?: boolean
      openSessions?: string[]
    } = {},
  ) {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    let listener: ((event: { details: OpenCodeEvent }) => void) | undefined
    const current = { ...session, parentID: options.parentID }
    const unsubscribe = mock(() => {})
    const get = mock(async ({ sessionID }: { sessionID: string }) => {
      if (options.failSession) throw new Error("Session unavailable")
      return { ...current, id: sessionID }
    })
    const context = mock(async () => {
      if (options.failHistory) throw new Error("History unavailable")
      return [
        { type: "user", text: "Old query", time: { created: 10 } },
        { type: "user", text: "Latest query", time: { created: 20 } },
        {
          type: "assistant",
          content: [{ type: "reasoning", text: "private" }],
          time: { created: 30 },
        },
        {
          type: "assistant",
          content: [{ type: "text", text: "Latest response" }],
          time: { created: 35 },
        },
      ]
    })
    const ctx = {
      location: { directory: "/project" },
      ui: {
        router: { current: () => ({ type: "session", sessionID: "s1" }) },
        tabs: {
          enabled: () => options.openSessions !== undefined,
          list: () =>
            (options.openSessions ?? []).map((sessionID) => ({ sessionID })),
        },
      },
      client: { session: { get, context } },
      data: {
        listen: mock((callback: typeof listener) => {
          listener = callback
          return unsubscribe
        }),
        session: {
          root: (id: string) => (id === "s1" ? (options.parentID ?? id) : id),
          get: (id: string) =>
            options.cached === false ? undefined : { ...current, id },
          pending: { list: () => [] },
          message: { get: () => undefined, list: () => [] },
        },
      },
    } as unknown as Context
    const cleanup = tui.setup(ctx)
    if (cleanup) cleanups.push(cleanup)
    let sequence = 0
    async function emit(
      type: string,
      data: object,
      directory = "/project",
      overrides: object = {},
    ) {
      listener?.({
        details: {
          id: `event-${++sequence}`,
          created: 40,
          type,
          data:
            type === "session.created"
              ? { location: { directory }, ...data }
              : data,
          location: { directory },
          ...overrides,
        } as OpenCodeEvent,
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    function payloads(includeStart = false) {
      return writeSpy.mock.calls
        .map((call) => {
          const sequence = (call as unknown as [string, string])[1]
          return JSON.parse(sequence.slice(sequence.indexOf(";{") + 1, -1))
        })
        .filter((payload) => includeStart || payload.event !== "session_start")
    }
    return { emit, payloads, cleanup, unsubscribe, ctx }
  }

  it("warns and does not subscribe outside a supported Warp terminal", () => {
    const h = harness()
    h.cleanup?.()
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    expect(tui.setup(h.ctx)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      "⚠️ Detected unsupported Warp version. Please update Warp to use this plugin.",
    )
    expect(h.ctx.data.listen).toHaveBeenCalledTimes(1)
  })

  it("reports session start with the plugin version and session directory", async () => {
    const h = harness()
    await h.emit("session.created", {
      sessionID: "s1",
      subpath: "packages/app",
    })
    expect(h.payloads(true)[0]).toMatchObject({
      event: "session_start",
      plugin_version: require("../package.json").version,
      session_id: "s1",
      cwd: "/project/packages/app",
    })
  })

  it("notifies delivered user prompts, not queued inputs or synthetic messages", async () => {
    const h = harness()
    await h.emit("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "i1",
      item: { type: "user", payload: { text: "hello" } },
    })
    await h.emit("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "i2",
      item: { type: "synthetic", payload: { text: "internal" } },
    })
    expect(h.payloads()).toEqual([])
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i1" })
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i2" })
    await h.emit("session.text.delta", { sessionID: "s1", text: "hello" })
    expect(h.payloads()).toHaveLength(1)
    expect(h.payloads()[0]).toMatchObject({
      event: "prompt_submit",
      query: "hello",
    })
  })

  it.each([
    [
      "session.execution.succeeded",
      { sessionID: "s1" },
      false,
      { event: "stop", query: "Latest query", response: "Latest response" },
    ],
    [
      "session.execution.failed",
      { sessionID: "s1" },
      true,
      { event: "stop", query: "", response: "" },
    ],
    [
      "form.created",
      { form: { sessionID: "s1", title: "Choose" } },
      false,
      { event: "question_asked", tool_name: "question" },
    ],
  ])("maps %s to a notification", async (type, data, failHistory, expected) => {
    const h = harness({ failHistory })
    await h.emit(type, data)
    expect(h.payloads()).toHaveLength(1)
    expect(h.payloads()[0]).toMatchObject(expected)
  })

  it("resets status on user interruption, but not a superseded execution", async () => {
    const h = harness()
    await h.emit("session.execution.interrupted", {
      sessionID: "s1",
      reason: "superseded",
    })
    await h.emit("session.execution.interrupted", {
      sessionID: "s1",
      reason: "user",
    })
    expect(h.payloads()).toHaveLength(1)
    expect(h.payloads()[0].event).toBe("stop")
  })

  it("maps V2 permissions and ignores rejected replies", async () => {
    const h = harness()
    await h.emit("permission.asked", {
      sessionID: "s1",
      action: "shell",
      resources: ["git status"],
      metadata: { command: "git status" },
    })
    await h.emit("permission.replied", { sessionID: "s1", reply: "reject" })
    await h.emit("permission.replied", { sessionID: "s1", reply: "once" })
    expect(h.payloads()).toHaveLength(2)
    expect(h.payloads()[0]).toMatchObject({
      event: "permission_request",
      tool_name: "shell",
      summary: "Wants to run shell: git status",
    })
    expect(h.payloads()[1].event).toBe("permission_replied")
  })

  it("emits one completion per tool and retains its V2 name", async () => {
    const h = harness()
    const data = {
      sessionID: "s1",
      assistantMessageID: "m1",
      id: "t1",
      name: "shell",
    }
    await h.emit("session.tool.input.started", data)
    await h.emit("session.tool.success", data)
    await h.emit("session.tool.success", data)
    expect(h.payloads()).toHaveLength(1)
    expect(h.payloads()[0]).toMatchObject({
      event: "tool_complete",
      tool_name: "shell",
    })
  })

  it("suppresses subagent notifications", async () => {
    const h = harness({ parentID: "parent" })
    await h.emit("session.created", { sessionID: "s1", parentID: "parent" })
    await h.emit("permission.asked", {
      sessionID: "s1",
      action: "shell",
      resources: [],
    })
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    expect(h.payloads(true)).toEqual([])
  })

  it("ignores other locations and unrelated events", async () => {
    const h = harness()
    await h.emit("session.created", { sessionID: "s1" }, "/other-project")
    await h.emit("model.updated", {})
    expect(h.payloads(true)).toEqual([])
  })

  it("skips unknown sessions rather than leaking subagent notifications", async () => {
    const h = harness({ cached: false, failSession: true })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    expect(h.payloads()).toEqual([])
  })

  it("unsubscribes and prevents queued notifications after cleanup", async () => {
    const h = harness()
    const event = h.emit("session.created", { sessionID: "s1" })
    h.cleanup?.()
    await event
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(h.payloads()).toEqual([])
  })

  it("ignores another terminal's root session in the same directory", async () => {
    const h = harness()
    await h.emit("permission.asked", {
      sessionID: "other",
      action: "shell",
      resources: [],
    })
    expect(h.payloads(true)).toEqual([])
  })

  it("includes open root-session tabs but never their subagents", async () => {
    const h = harness({ openSessions: ["s1", "s2", "child"] })
    const getSession = h.ctx.data.session.get
    h.ctx.data.session.get = (id) =>
      id === "child"
        ? ({ ...session, id, parentID: "s2" } as SessionInfo)
        : getSession(id)
    await h.emit("form.created", { form: { sessionID: "s2" } })
    await h.emit("form.created", { form: { sessionID: "child" } })
    expect(
      h.payloads(true).map((payload) => [payload.event, payload.session_id]),
    ).toEqual([
      ["session_start", "s2"],
      ["question_asked", "s2"],
    ])
  })

  it("resets working status when a queued prompt is actually delivered", async () => {
    const h = harness()
    await h.emit("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "i1",
      item: { type: "user", delivery: "queue", payload: { text: "next" } },
    })
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i1" })
    expect(h.payloads().map((payload) => payload.event)).toEqual([
      "stop",
      "prompt_submit",
    ])
  })

  it("does not notify cancelled queued prompts", async () => {
    const h = harness()
    await h.emit("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "i1",
      item: { type: "user", delivery: "queue", payload: { text: "cancelled" } },
    })
    await h.emit("session.inbox.cancelled", { sessionID: "s1", inboxID: "i1" })
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i1" })
    expect(h.payloads(true)).toEqual([])
  })

  it("does not block another tab's permission notification on a stalled history fetch", async () => {
    const h = harness({ openSessions: ["s1", "s2"] })
    h.ctx.client.session.context = () => new Promise(() => {})
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    await h.emit("permission.asked", {
      sessionID: "s2",
      action: "shell",
      resources: [],
    })
    expect(h.payloads()[0]).toMatchObject({
      event: "permission_request",
      session_id: "s2",
    })
    h.cleanup?.()
  })

  it("bounds history requests and unblocks the same session after timeout", async () => {
    const h = harness()
    const deadline = new AbortController()
    spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal)
    h.ctx.client.session.context = () => new Promise(() => {})
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    await h.emit("permission.asked", {
      sessionID: "s1",
      action: "shell",
      resources: [],
    })
    expect(h.payloads()).toEqual([])
    deadline.abort(new Error("timeout"))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(h.payloads().map((payload) => payload.event)).toEqual([
      "stop",
      "permission_request",
    ])
  })

  it.each(["local", "server"] as const)(
    "excludes next-turn messages from %s completion history",
    async (source) => {
      const h = harness()
      const messages = [
        { type: "user", text: "finished", time: { created: 20 } },
        {
          type: "assistant",
          content: [{ type: "text", text: "done" }],
          time: { created: 30 },
        },
        { type: "user", text: "next", time: { created: 50 } },
        {
          type: "assistant",
          content: [{ type: "text", text: "later" }],
          time: { created: 60 },
        },
      ] as SessionMessageInfo[]
      if (source === "local") h.ctx.data.session.message.list = () => messages
      else h.ctx.client.session.context = async () => messages
      await h.emit("session.execution.succeeded", { sessionID: "s1" })
      expect(h.payloads()[0]).toMatchObject({
        query: "finished",
        response: "done",
      })
    },
  )

  it("deduplicates replayed permission and completion events", async () => {
    const h = harness()
    const data = { sessionID: "s1", action: "shell", resources: [] }
    await h.emit("permission.asked", data, "/project", { id: "permission-1" })
    await h.emit("permission.asked", data, "/project", { id: "permission-1" })
    await h.emit(
      "session.execution.succeeded",
      { sessionID: "s1" },
      "/project",
      { id: "stop-1" },
    )
    await h.emit(
      "session.execution.succeeded",
      { sessionID: "s1" },
      "/project",
      { id: "stop-1" },
    )
    expect(h.payloads().map((payload) => payload.event)).toEqual([
      "permission_request",
      "stop",
    ])
  })

  it.each(["cleanup", "tab closed"] as const)(
    "suppresses a late completion after %s",
    async (action) => {
      const h = harness()
      let finish: ((messages: SessionMessageInfo[]) => void) | undefined
      let signal: AbortSignal | undefined
      h.ctx.client.session.context = (_input, options) => {
        signal = options?.signal
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      await h.emit("session.execution.succeeded", { sessionID: "s1" })
      if (action === "cleanup") {
        h.cleanup?.()
        expect(signal?.aborted).toBe(true)
        expect(h.unsubscribe).toHaveBeenCalledTimes(1)
      } else h.ctx.ui.router.current = () => ({ type: "home" })
      finish?.([])
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(h.payloads(true)).toEqual([])
    },
  )
})
