import { describe, expect, it } from "bun:test"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const directory = resolve(import.meta.dir, "..")

describe("local plugin entrypoints", () => {
    it("resolves the CLI entrypoint from the directory", () => {
        expect(require.resolve(resolve(directory, "tui"))).toBe(resolve(directory, "tui.js"))
    })

    it("resolves the server entrypoint from the directory", () => {
        expect(require.resolve(directory)).toBe(resolve(directory, "dist/index.js"))
    })
})
