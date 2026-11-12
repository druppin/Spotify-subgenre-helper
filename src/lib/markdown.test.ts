import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "./markdown.ts";

test("inline emphasis, code and links", () => {
  assert.deepEqual(parseInline("a **bold** and *it* `x*y` [site](https://e.com)"), [
    { kind: "text", text: "a " },
    { kind: "strong", children: [{ kind: "text", text: "bold" }] },
    { kind: "text", text: " and " },
    { kind: "em", children: [{ kind: "text", text: "it" }] },
    { kind: "text", text: " " },
    { kind: "code", text: "x*y" },
    { kind: "text", text: " " },
    { kind: "link", href: "https://e.com", children: [{ kind: "text", text: "site" }] },
  ]);
  // Things that only look like markup stay text.
  assert.deepEqual(parseInline("snake_case_name and 2 * 3 * 4"), [{ kind: "text", text: "snake_case_name and 2 * 3 * 4" }]);
  assert.deepEqual(parseInline("a<br>b <b>x</b>"), [
    { kind: "text", text: "a" },
    { kind: "br" },
    { kind: "text", text: "b <b>x</b>" },
  ]);
  // Only http(s) links become links.
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ kind: "text", text: "[x](javascript:alert(1))" }]);
});

test("blocks: headings, lists, code, tables, paragraphs", () => {
  const blocks = parseMarkdown(
    [
      "## Verdict",
      "Liquid, not neuro.",
      "Second line.",
      "",
      "- one",
      "- **two**",
      "  - nested",
      "",
      "1. first",
      "2. second",
      "",
      "```js",
      "let a = 1;",
      "```",
      "| Tag | Fit |",
      "|---|:-:|",
      "| liquid | yes |",
    ].join("\n")
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["heading", "paragraph", "list", "list", "code", "table"]
  );
  const para = blocks[1] as Extract<(typeof blocks)[number], { kind: "paragraph" }>;
  assert.equal(para.children[1].kind, "br");
  const bullets = blocks[2] as Extract<(typeof blocks)[number], { kind: "list" }>;
  assert.equal(bullets.items.length, 2);
  assert.equal(bullets.items[1][1].kind, "list");
  const numbered = blocks[3] as Extract<(typeof blocks)[number], { kind: "list" }>;
  assert.equal(numbered.ordered, true);
  const table = blocks[5] as Extract<(typeof blocks)[number], { kind: "table" }>;
  assert.deepEqual(table.align, [null, "center"]);
  assert.equal(table.rows.length, 1);
});
