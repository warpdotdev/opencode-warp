import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { truncate, extractTextFromParts } from "../src/index"

describe("truncate", () => {
  it("returns string unchanged when under maxLen", () => {
    assert.strictEqual(truncate("hello", 10), "hello")
  })

  it("returns string unchanged when exactly maxLen", () => {
    assert.strictEqual(truncate("hello", 5), "hello")
  })

  it("truncates and adds ellipsis when over maxLen", () => {
    assert.strictEqual(truncate("hello world", 8), "hello...")
  })

  it("handles maxLen of 3 (minimum for ellipsis)", () => {
    assert.strictEqual(truncate("hello", 3), "...")
  })

  it("handles empty string", () => {
    assert.strictEqual(truncate("", 10), "")
  })
})

describe("extractTextFromParts", () => {
  it("extracts text from text parts", () => {
    const parts = [
      { type: "text" as const, text: "hello" },
      { type: "text" as const, text: "world" },
    ]
    assert.strictEqual(extractTextFromParts(parts), "hello world")
  })

  it("skips non-text parts", () => {
    const parts = [
      { type: "text" as const, text: "hello" },
      { type: "tool_use" as const, id: "1", name: "bash", input: {} },
      { type: "text" as const, text: "world" },
    ] as any[]
    assert.strictEqual(extractTextFromParts(parts), "hello world")
  })

  it("skips text parts with empty text", () => {
    const parts = [
      { type: "text" as const, text: "" },
      { type: "text" as const, text: "hello" },
    ]
    assert.strictEqual(extractTextFromParts(parts), "hello")
  })

  it("returns empty string for no parts", () => {
    assert.strictEqual(extractTextFromParts([]), "")
  })

  it("returns empty string when all parts are non-text", () => {
    const parts = [
      { type: "tool_use" as const, id: "1", name: "bash", input: {} },
    ] as any[]
    assert.strictEqual(extractTextFromParts(parts), "")
  })
})
