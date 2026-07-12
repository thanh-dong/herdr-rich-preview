import { describe, expect, test } from "bun:test"
import { inferPreviewRenderer } from "./preview-renderer"

describe("inferPreviewRenderer", () => {
  test("markdown", () => {
    expect(inferPreviewRenderer("docs/README.md")).toEqual({ kind: "markdown" })
    expect(inferPreviewRenderer("a.mdx")).toEqual({ kind: "markdown" })
  })

  test("embeds", () => {
    expect(inferPreviewRenderer("chart.mmd")).toEqual({ kind: "embed", format: "mermaid" })
    expect(inferPreviewRenderer("arch.d2")).toEqual({ kind: "embed", format: "d2" })
    expect(inferPreviewRenderer("page.html")).toEqual({ kind: "embed", format: "html" })
    expect(inferPreviewRenderer("icon.svg")).toEqual({ kind: "embed", format: "svg" })
  })

  test("images", () => {
    expect(inferPreviewRenderer("shot.png")).toEqual({ kind: "image", mime: "image/png" })
  })

  test("code and fallbacks", () => {
    expect(inferPreviewRenderer("src/a.ts")).toEqual({ kind: "code", language: "ts" })
    expect(inferPreviewRenderer("Makefile")).toEqual({ kind: "code", language: null })
    expect(inferPreviewRenderer("bundle.zip")).toEqual({ kind: "unsupported" })
  })
})
