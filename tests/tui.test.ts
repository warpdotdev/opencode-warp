import { afterEach, beforeEach, describe, it, expect } from "bun:test"
import { mock } from "bun:test"
import fs from "fs"

const writeSpy = mock(() => {})
mock.module("fs", () => ({
    ...fs,
    writeFileSync: writeSpy,
}))

const { default: WarpTuiPlugin } = await import("../src/tui")

type EventListener = (event: { details: unknown }) => void

function createContext(parentID?: string) {
    let listener: EventListener | undefined
    const notifications: Array<{ title?: string; message: string }> = []

    const context = {
        location: { directory: "/repo" },
        ui: {
            router: {
                current: () => ({ type: "session", sessionID: "session-1" }),
            },
        },
        data: {
            location: { default: () => ({ directory: "/repo" }) },
            listen: (callback: EventListener) => {
                listener = callback
                return () => { listener = undefined }
            },
            session: {
                sync: async () => {},
                get: () => ({ id: "session-1", parentID }),
            },
        },
        client: {
            session: {
                context: async () => [
                    { id: "user-1", type: "user", text: "Do the task" },
                    {
                        id: "assistant-1",
                        type: "assistant",
                        content: [{ type: "text", text: "Task complete" }],
                    },
                ],
            },
        },
        attention: {
            notify: async (notification: { title?: string; message: string }) => {
                notifications.push(notification)
                return { ok: true, notification: true, sound: false }
            },
        },
    }

    return {
        context,
        notifications,
        emit(event: unknown) {
            listener?.({ details: event })
        },
    }
}

async function flushEvents() {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("OpenCode V2 CLI plugin", () => {
    const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    const originalTTY = process.env.WARP_CLI_AGENT_TTY

    beforeEach(() => {
        writeSpy.mockClear()
        process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
        process.env.WARP_CLI_AGENT_TTY = "/dev/warp-test-tty"
    })

    afterEach(() => {
        if (originalVersion === undefined) delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
        else process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
        if (originalTTY === undefined) delete process.env.WARP_CLI_AGENT_TTY
        else process.env.WARP_CLI_AGENT_TTY = originalTTY
    })

    it("does not change this pane when another session finishes", async () => {
        const fixture = createContext()
        const cleanup = (WarpTuiPlugin as any).setup(fixture.context)
        try {
            fixture.emit({
                type: "session.execution.succeeded",
                created: Date.now(),
                location: { directory: "/repo" },
                data: { sessionID: "another-session" },
            })
            await flushEvents()
            expect(writeSpy).not.toHaveBeenCalled()
            expect(fixture.notifications).toHaveLength(0)
        } finally {
            cleanup()
        }
    })

    it("sends completion data through the V2 attention API", async () => {
        const fixture = createContext()
        const cleanup = (WarpTuiPlugin as any).setup(fixture.context)

        fixture.emit({
            type: "session.execution.succeeded",
            created: Date.now(),
            location: { directory: "/repo" },
            data: { sessionID: "session-1" },
        })
        await flushEvents()

        expect(fixture.notifications).toHaveLength(1)
        expect(fixture.notifications[0].message).toBe("Task complete")
        expect(writeSpy).toHaveBeenCalledTimes(1)
        const [tty, sequence] = writeSpy.mock.calls[0] as [string, string]
        expect(tty).toBe("/dev/warp-test-tty")
        expect(sequence).toContain('"event":"stop"')
        expect(sequence).toContain('"session_id":"session-1"')
        cleanup()
    })

    it("does not send a subagent completion notification", async () => {
        const fixture = createContext("parent-session")
        const cleanup = (WarpTuiPlugin as any).setup(fixture.context)

        fixture.emit({
            type: "session.execution.succeeded",
            created: Date.now(),
            location: { directory: "/repo" },
            data: { sessionID: "session-1" },
        })
        await flushEvents()

        expect(fixture.notifications).toHaveLength(0)
        cleanup()
    })
})
