import type { Plugin } from "@opencode/plugin"
import { WarpPlugin } from "./v1.js"

interface Definition {
  id: string
  setup(): void
  server(input: unknown, options?: unknown): Promise<unknown>
}

// Do not expose legacy peer types through the V2 package's main declaration.
const definition: Definition = {
  id: "opencode-warp",
  setup() {},
  server: WarpPlugin as Definition["server"],
} satisfies Plugin.Plugin & Definition

export default definition
