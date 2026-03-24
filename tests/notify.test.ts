import { describe, it, afterEach, mock } from "bun:test"
import { expect } from "bun:test"
import fs from "fs"

const writeSpy = mock(() => {})
mock.module("fs", () => ({
  ...fs,
  writeFileSync: writeSpy,
}))

const { warpNotify } = await import("../src/notify")

describe("warpNotify", () => {
  const originalTermProgram = process.env.TERM_PROGRAM

  afterEach(() => {
    writeSpy.mockClear()
    if (originalTermProgram === undefined) {
      delete process.env.TERM_PROGRAM
    } else {
      process.env.TERM_PROGRAM = originalTermProgram
    }
  })

  it("skips when TERM_PROGRAM is not set", () => {
    delete process.env.TERM_PROGRAM
    warpNotify("title", "body")
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("skips for other terminal programs", () => {
    process.env.TERM_PROGRAM = "iTerm.app"
    warpNotify("title", "body")
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("writes OSC 777 sequence when inside Warp", () => {
    process.env.TERM_PROGRAM = "WarpTerminal"
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
