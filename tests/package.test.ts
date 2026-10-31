import { describe, it, expect } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

describe("published entrypoints", () => {
  it("loads the built server and TUI through the V2 package loader", async () => {
    const repo = path.resolve(import.meta.dir, "..")
    const temp = mkdtempSync(
      path.join(
        process.env.OPENCODE_TEST_TMPDIR || tmpdir(),
        "opencode-warp-package-",
      ),
    )
    const consumer = path.join(temp, "consumer")
    const installed = path.join(
      consumer,
      "node_modules/@warp-dot-dev/opencode-warp",
    )
    const tsc = path.join(repo, "node_modules/typescript/bin/tsc")
    try {
      mkdirSync(installed, { recursive: true })
      copyFileSync(
        path.join(repo, "package.json"),
        path.join(installed, "package.json"),
      )
      execFileSync("node", [tsc, "--outDir", path.join(installed, "dist")], {
        cwd: repo,
        timeout: 60_000,
        stdio: "inherit",
      })
      const host = path.join(repo, "node_modules/@opencode/plugin/dist/host.js")
      const output = execFileSync(
        process.execPath,
        [
          "--eval",
          `
        import { Host } from ${JSON.stringify(host)}
        import assert from "node:assert/strict"
        const entries = Host.resolve({ directory: ${JSON.stringify(consumer)}, name: "@warp-dot-dev/opencode-warp" })
        assert.ok(entries.server?.endsWith("/dist/index.js"))
        assert.ok(entries.tui?.endsWith("/dist/tui.js"))
        const server = (await Host.load(entries.server)).default
        const tui = (await Host.load(entries.tui)).default
        assert.equal((await import("@warp-dot-dev/opencode-warp/server")).default, server)
        assert.equal(server.id, "opencode-warp")
        assert.equal(tui.id, "opencode-warp.cli")
        server.setup()
        console.log("package exports verified")
      `,
        ],
        { cwd: consumer, encoding: "utf8", timeout: 30_000 },
      )
      expect(output.trim()).toBe("package exports verified")
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 90_000)
})
