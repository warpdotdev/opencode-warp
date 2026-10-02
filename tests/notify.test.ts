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
const { default: plugin } = await import("../src/index")
const { WarpPlugin } = await import("../src/v1")
const { default: tui } = await import("../src/tui")
const { PLUGIN_VERSION } = await import("../src/version")

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

describe("OpenCode V1 permission schemas", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
  afterEach(() => {
    writeSpy.mockClear()
    if (originalVersion === undefined)
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    else process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
  })

  async function legacy() {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    const hooks = await WarpPlugin({
      directory: "/project",
      client: {
        app: { log: async () => {} },
        session: { get: async () => ({ data: { id: "s1" } }) },
      },
    } as unknown as Parameters<typeof WarpPlugin>[0])
    return async (type: string, properties: object) => {
      await hooks.event?.({ event: { type, properties } } as never)
    }
  }

  it("recognizes the legacy permission.updated type field", async () => {
    const emit = await legacy()
    await emit("permission.updated", {
      sessionID: "s1",
      type: "bash",
      metadata: { command: "git status" },
    })
    expect(
      (writeSpy.mock.calls[0] as unknown as [string, string])[1],
    ).toContain('"tool_name":"bash"')
  })

  it("recognizes the newer permission.asked permission field", async () => {
    const emit = await legacy()
    await emit("permission.asked", {
      sessionID: "s1",
      permission: "bash",
      metadata: { command: "git status" },
    })
    expect(
      (writeSpy.mock.calls[0] as unknown as [string, string])[1],
    ).toContain('"tool_name":"bash"')
  })

  it("does not report rejected requests as approvals with either reply schema", async () => {
    const emit = await legacy()
    await emit("permission.replied", { sessionID: "s1", response: "reject" })
    await emit("permission.replied", { sessionID: "s1", reply: "reject" })
    expect(writeSpy).not.toHaveBeenCalled()
    await emit("permission.replied", { sessionID: "s1", reply: "once" })
    expect(writeSpy.mock.calls).toHaveLength(1)
    expect(
      (writeSpy.mock.calls[0] as unknown as [string, string])[1],
    ).toContain('"event":"permission_replied"')
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
      location?: false
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
      location:
        options.location === false ? undefined : { directory: "/project" },
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
    return { emit, payloads, cleanup, unsubscribe, get, ctx }
  }

  it("exposes a valid V2 definition and the V1 server entrypoint", () => {
    expect(plugin.id).toBe("opencode-warp")
    expect(typeof plugin.setup).toBe("function")
    expect(plugin.server).toBe(WarpPlugin)
    expect(tui.id).toBe("opencode-warp.cli")
    expect(PLUGIN_VERSION).toBe(require("../package.json").version)
  })

  it("does not subscribe outside a supported Warp terminal", () => {
    const h = harness()
    h.cleanup?.()
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    expect(tui.setup(h.ctx)).toBeUndefined()
    expect(h.ctx.data.listen).toHaveBeenCalledTimes(1)
  })

  it("preserves the V1 prompt and tool hooks", async () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    const hooks = await WarpPlugin({
      directory: "/project",
      client: {
        app: { log: async () => {} },
        session: { get: async () => ({ data: { id: "s1" } }) },
      },
    } as unknown as Parameters<typeof WarpPlugin>[0])
    await hooks["chat.message"]?.({ sessionID: "s1" }, {
      parts: [{ type: "text", text: "Legacy prompt" }],
    } as never)
    await hooks["tool.execute.before"]?.(
      { tool: "question", sessionID: "s1", callID: "t1" },
      { args: {} },
    )
    expect(writeSpy.mock.calls).toHaveLength(2)
    expect(
      (writeSpy.mock.calls[0] as unknown as [string, string])[1],
    ).toContain("prompt_submit")
    expect(
      (writeSpy.mock.calls[1] as unknown as [string, string])[1],
    ).toContain("question_asked")
  })

  it("reports session start with the plugin version and session directory", async () => {
    const h = harness()
    await h.emit("session.created", { sessionID: "s1" })
    expect(h.payloads(true)[0]).toMatchObject({
      event: "session_start",
      plugin_version: PLUGIN_VERSION,
      session_id: "s1",
      cwd: "/project",
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

  it("extracts the latest prompt and assistant text on completion", async () => {
    const h = harness()
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    expect(h.payloads()[0]).toMatchObject({
      event: "stop",
      query: "Latest query",
      response: "Latest response",
    })
  })

  it("still notifies after failure or unavailable history", async () => {
    const h = harness({ failHistory: true })
    await h.emit("session.execution.failed", { sessionID: "s1" })
    expect(h.payloads()[0]).toMatchObject({
      event: "stop",
      query: "",
      response: "",
    })
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

  it("maps forms to questions needing user input", async () => {
    const h = harness()
    await h.emit("form.created", { form: { sessionID: "s1", title: "Choose" } })
    expect(h.payloads()[0]).toMatchObject({
      event: "question_asked",
      tool_name: "question",
    })
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
    expect(h.payloads()).toEqual([])
  })

  it("ignores other locations and unrelated events", async () => {
    const h = harness()
    await h.emit("session.created", { sessionID: "s1" }, "/other-project")
    await h.emit("model.updated", {})
    expect(h.payloads()).toEqual([])
  })

  it("fetches and caches uncached session metadata", async () => {
    const h = harness({ cached: false })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(h.payloads()).toHaveLength(2)
  })

  it("skips unknown sessions rather than leaking subagent notifications", async () => {
    const h = harness({ cached: false, failSession: true })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    expect(h.payloads()).toEqual([])
  })

  it("does not emit a late completion after cleanup during a history fetch", async () => {
    const h = harness()
    let resolveHistory: ((messages: []) => void) | undefined
    let historyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      historyStarted = resolve
    })
    h.ctx.client.session.context = () =>
      new Promise((resolve) => {
        resolveHistory = resolve
        historyStarted?.()
      })
    const event = h.emit("session.execution.succeeded", { sessionID: "s1" })
    await started
    h.cleanup?.()
    resolveHistory?.([])
    await event
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

  it("preserves completion/prompt order during asynchronous history reads", async () => {
    const h = harness({ cached: false })
    await Promise.all([
      h.emit("session.execution.succeeded", { sessionID: "s1" }),
      h.emit("session.inbox.enqueued", {
        sessionID: "s1",
        inboxID: "i1",
        item: { type: "user", payload: { text: "next" } },
      }),
    ])
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i1" })
    expect(h.payloads().map((payload) => payload.event)).toEqual([
      "stop",
      "prompt_submit",
    ])
  })

  it("does not broadcast to unrelated projects when the CLI has no location", async () => {
    const h = harness({ location: false })
    await h.emit(
      "form.created",
      { form: { sessionID: "other" } },
      "/other-project",
    )
    expect(h.payloads(true)).toEqual([])
    expect(h.get).not.toHaveBeenCalled()
    await h.emit("form.created", { form: { sessionID: "s1" } })
    expect(h.payloads()[0].event).toBe("question_asked")
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
    const h = harness({ openSessions: ["s1", "s2"] })
    await h.emit("form.created", { form: { sessionID: "s2" } })
    await h.emit("form.created", { form: { sessionID: "child" } })
    expect(h.payloads()).toHaveLength(1)
    expect(h.payloads()[0].session_id).toBe("s2")
  })

  it("fails closed on the home route with no open tabs", async () => {
    const h = harness({ location: false })
    h.ctx.ui.router.current = () => ({ type: "home" })
    await h.emit("session.created", { sessionID: "s1" })
    expect(h.payloads(true)).toEqual([])
  })

  it("announces a new session after navigation even if its creation event arrived on home", async () => {
    const h = harness()
    h.ctx.ui.router.current = () => ({ type: "home" })
    await h.emit("session.created", { sessionID: "s1" })
    h.ctx.ui.router.current = () => ({ type: "session", sessionID: "s1" })
    await h.emit("session.inbox.enqueued", {
      sessionID: "s1",
      inboxID: "i1",
      item: { type: "user", payload: { text: "new" } },
    })
    await h.emit("session.inbox.delivered", { sessionID: "s1", inboxID: "i1" })
    expect(h.payloads(true).map((payload) => payload.event)).toEqual([
      "session_start",
      "prompt_submit",
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

  it("aborts an outstanding request on cleanup", async () => {
    const h = harness()
    let signal: AbortSignal | undefined
    h.ctx.client.session.context = (_input, options) => {
      signal = options?.signal
      return new Promise(() => {})
    }
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    expect(signal?.aborted).toBe(false)
    h.cleanup?.()
    expect(signal?.aborted).toBe(true)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(h.payloads(true)).toEqual([])
  })

  it("uses a local completion snapshot and excludes messages from the next turn", async () => {
    const h = harness()
    h.ctx.data.session.message.list = () =>
      [
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
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    expect(h.payloads()[0]).toMatchObject({
      query: "finished",
      response: "done",
    })
    expect(h.ctx.client.session.context).not.toHaveBeenCalled()
  })

  it("ignores future messages in a delayed server history response", async () => {
    const h = harness()
    h.ctx.client.session.context = async () =>
      [
        { type: "user", text: "finished", time: { created: 20 } },
        {
          type: "assistant",
          content: [{ type: "text", text: "done" }],
          time: { created: 30 },
        },
        { type: "user", text: "next", time: { created: 50 } },
      ] as SessionMessageInfo[]
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    expect(h.payloads()[0]).toMatchObject({
      query: "finished",
      response: "done",
    })
  })

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

  it("invalidates fallback session metadata after a move", async () => {
    const h = harness({ cached: false, location: false })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    h.ctx.client.session.get = async () => ({
      ...session,
      location: { directory: "/moved" },
    })
    await h.emit("session.moved", { sessionID: "s1" }, "/moved")
    await h.emit("form.created", { form: { sessionID: "s1" } }, "/moved")
    expect(h.payloads().map((payload) => payload.cwd)).toEqual([
      "/project",
      "/moved",
    ])
  })

  it("includes the session subpath in the notification cwd", async () => {
    const h = harness()
    await h.emit("session.created", {
      sessionID: "s1",
      subpath: "packages/app",
    })
    expect(h.payloads(true)[0].cwd).toBe("/project/packages/app")
  })

  it("refreshes deleted session state instead of reusing old metadata", async () => {
    const h = harness({ cached: false })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    await h.emit("session.deleted", { sessionID: "s1" })
    await h.emit("form.created", { form: { sessionID: "s1" } })
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(
      h.payloads(true).filter((payload) => payload.event === "session_start"),
    ).toHaveLength(2)
  })

  it("suppresses a late response after its tab has been closed", async () => {
    const h = harness()
    let finish: ((messages: SessionMessageInfo[]) => void) | undefined
    h.ctx.client.session.context = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    await h.emit("session.execution.succeeded", { sessionID: "s1" })
    h.ctx.ui.router.current = () => ({ type: "home" })
    finish?.([])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(h.payloads(true)).toEqual([])
  })
})
