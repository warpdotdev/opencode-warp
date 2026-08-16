import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"

const notifySpy = mock(() => {})
mock.module("../src/notify", () => ({
    warpNotify: notifySpy,
}))

const { WarpPlugin } = await import("../src/index")

// Delay used by the deferred session_start emit in src/index.ts.
const DEFERRED_DELAY_MS = 2000

function makeClient() {
    return {
        app: { log: async () => ({}) },
        session: {
            get: async () => ({ data: {} }),
            list: async () => ({ data: [{ id: "sess-main" }] }),
            messages: async () => ({ data: [] }),
        },
    } as any
}

async function waitForDeferredEmit() {
    await new Promise((resolve) => setTimeout(resolve, DEFERRED_DELAY_MS + 300))
}

describe("deferred session_start handshake", () => {
    const originalProtocol = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION

    beforeEach(() => {
        process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
        notifySpy.mockClear()
    })

    afterEach(() => {
        if (originalProtocol === undefined) {
            delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
        } else {
            process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalProtocol
        }
    })

    it(
        "re-emits session_start after init when session.created was never handled",
        async () => {
            await WarpPlugin({ client: makeClient(), directory: "/tmp/proj" } as any)

            // Nothing yet: the emit is deferred past plugin init.
            expect(notifySpy).not.toHaveBeenCalled()

            await waitForDeferredEmit()

            expect(notifySpy).toHaveBeenCalledTimes(1)
            const [title, body] = notifySpy.mock.calls[0] as [string, string]
            expect(title).toBe("warp://cli-agent")
            const payload = JSON.parse(body)
            expect(payload.event).toBe("session_start")
            expect(payload.session_id).toBe("sess-main")
            expect(payload.plugin_version).toBeDefined()
        },
        10000,
    )

    it(
        "does not duplicate session_start when session.created already fired",
        async () => {
            const handlers = (await WarpPlugin({
                client: makeClient(),
                directory: "/tmp/proj",
            } as any)) as any

            await handlers.event({
                event: {
                    type: "session.created",
                    properties: { info: { id: "sess-main" } },
                },
            })
            expect(notifySpy).toHaveBeenCalledTimes(1)

            // The deferred emit must be suppressed by the dedup flag.
            await waitForDeferredEmit()
            expect(notifySpy).toHaveBeenCalledTimes(1)
        },
        10000,
    )

    it(
        "skips subagent sessions when picking the handshake session",
        async () => {
            const client = makeClient()
            client.session.list = async () => ({
                data: [{ id: "sess-sub", parentID: "sess-main-parent" }, { id: "sess-top" }],
            })

            await WarpPlugin({ client, directory: "/tmp/proj" } as any)
            await waitForDeferredEmit()

            expect(notifySpy).toHaveBeenCalledTimes(1)
            const [, body] = notifySpy.mock.calls[0] as [string, string]
            expect(JSON.parse(body).session_id).toBe("sess-top")
        },
        10000,
    )
})
