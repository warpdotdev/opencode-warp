import { describe, it, expect } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

describe("published entrypoints", () => {
  it("resolves named package exports in Bun and typechecks without legacy peers", async () => {
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
      await writeFile(
        path.join(consumer, "package.json"),
        JSON.stringify({ type: "module" }),
      )
      await writeFile(
        path.join(consumer, "consumer.ts"),
        `
        import plugin from "@warp-dot-dev/opencode-warp"
        const id: string = plugin.id
        plugin.setup()
        const hooks: Promise<unknown> = plugin.server({})
      `,
      )
      await writeFile(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
            types: [],
            noEmit: true,
          },
          files: ["consumer.ts"],
        }),
      )
      execFileSync("node", [tsc, "-p", path.join(consumer, "tsconfig.json")], {
        cwd: consumer,
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
        assert.equal(server.id, "opencode-warp")
        assert.equal(tui.id, "opencode-warp.cli")
        assert.equal(typeof server.server, "function")
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
