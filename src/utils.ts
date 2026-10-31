export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + "..."
}

export function extractTextFromParts(
  parts: readonly { type: string; text?: string }[],
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && "text" in p && Boolean(p.text),
    )
    .map((p) => p.text)
    .join(" ")
}
