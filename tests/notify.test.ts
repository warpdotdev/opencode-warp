import { describe, it, afterEach, mock } from "bun:test"
import { expect } from "bun:test"
import fs from "fs"

const writeSpy = mock(() => {})
mock.module("fs", () => ({
  ...fs,
  writeFileSync: writeSpy,
}))

const { warpNotify, resolveWarpTTY } = await import("../src/notify")

describe("resolveWarpTTY", () => {
  it("uses the CLI input terminal when the Warp CLI has a TTY", () => {
    expect(resolveWarpTTY(undefined, true, 0, () => "/dev/ttys022")).toBe("/dev/ttys022")
  })

  it("prefers an explicitly configured Warp terminal", () => {
    expect(resolveWarpTTY("/dev/ttys015", true, 0, () => "/dev/ttys022")).toBe("/dev/ttys015")
  })

  it("returns no terminal path when stdin is not a TTY", () => {
    expect(resolveWarpTTY(undefined, false, undefined, () => "/dev/ttys022")).toBeUndefined()
  })
})

describe("warpNotify", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
  const originalTTY = process.env.WARP_CLI_AGENT_TTY

  afterEach(() => {
    writeSpy.mockClear()
    if (originalVersion === undefined) {
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    } else {
      process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
    }
    if (originalTTY === undefined) {
      delete process.env.WARP_CLI_AGENT_TTY
    } else {
      process.env.WARP_CLI_AGENT_TTY = originalTTY
    }
  })

  it("skips when WARP_CLI_AGENT_PROTOCOL_VERSION is not set", () => {
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    warpNotify("title", "body")
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("writes OSC 777 sequence when Warp declares protocol support", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    delete process.env.WARP_CLI_AGENT_TTY
    warpNotify("warp://cli-agent", '{"event":"stop"}')
    expect(writeSpy).toHaveBeenCalledTimes(1)

    const [path, data] = writeSpy.mock.calls[0] as [string, string]
    expect(path).toBe("/dev/tty")
    expect(data).toContain("warp://cli-agent")
    expect(data).toContain('{"event":"stop"}')
    expect(data).toMatch(/^\x1b\]777;notify;/)
    expect(data).toMatch(/\x07$/)
  })

  it("writes to Warp's configured pane TTY when available", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    process.env.WARP_CLI_AGENT_TTY = "/dev/ttys022"

    warpNotify("warp://cli-agent", '{"event":"stop"}')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const [path, data] = writeSpy.mock.calls[0] as [string, string]
    expect(path).toBe("/dev/ttys022")
    expect(data).toContain('{"event":"stop"}')
  })
})
