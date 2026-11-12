/*
 * A small Markdown parser for the AI's chat answers: the parts chat models
 * actually use (headings, lists, code, quotes, tables, emphasis, links).
 * It returns plain data that Markdown.tsx turns into React elements, so an
 * answer can never inject HTML. Pure, so it's tested with `npm test`.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "br" };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; header: Inline[][]; align: ("left" | "center" | "right" | null)[]; rows: Inline[][][] }
  | { kind: "hr" };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "    ").length;

export function parseMarkdown(text: string): Block[] {
  return parseLines(text.replace(/\r\n?/g, "\n").split("\n"));
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && isBlank(lines[i].trim().slice(3)))) {
        body.push(lines[i++]);
      }
      i++; // the closing fence (or the end, for an unclosed block)
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ kind: "quote", blocks: parseLines(body) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        rows.push(splitRow(lines[i++]).map(parseInline));
      }
      blocks.push({ kind: "table", header: header.map(parseInline), align, rows });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [block, next] = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    // Single line breaks are kept: chat answers use them on purpose.
    const body: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !(body.length > 0 && HR.test(lines[i]))
    ) {
      body.push(lines[i++].trim());
    }
    blocks.push({ kind: "paragraph", children: joinLines(body) });
  }
  return blocks;
}

// A list and everything nested in it; returns the list and the next line to read.
function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = first[3] !== undefined;
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const item = ITEM.exec(lines[i]);
    if (!item || item[1].length !== indent || (item[3] !== undefined) !== ordered) break;
    // The item's own text, then any lines indented under it (continuations,
    // nested lists, code), up to the next item at this level.
    const body = [item[4]];
    i++;
    while (i < lines.length) {
      if (isBlank(lines[i])) {
        // A blank line ends the item unless something indented follows it.
        if (i + 1 < lines.length && indentOf(lines[i + 1]) > indent) {
          body.push("");
          i++;
          continue;
        }
        break;
      }
      if (indentOf(lines[i]) <= indent && (ITEM.test(lines[i]) || HEADING.test(lines[i]) || FENCE.test(lines[i]))) break;
      body.push(indentOf(lines[i]) > indent ? lines[i].slice(Math.min(indentOf(lines[i]), indent + 2)) : lines[i]);
      i++;
    }
    items.push(parseLines(body));
    // A blank line between items at this level keeps the list going.
    if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length) {
      const next = ITEM.exec(lines[i + 1]);
      if (next && next[1].length === indent && (next[3] !== undefined) === ordered) i++;
    }
  }
  return [{ kind: "list", ordered, start: ordered ? Number(first[3]) : 1, items }, i];
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function joinLines(lines: string[]): Inline[] {
  return lines.flatMap((line, i) => (i === 0 ? parseInline(line) : [{ kind: "br" } as Inline, ...parseInline(line)]));
}

// Delimiters for emphasis, longest first so ** wins over *.
const EMPHASIS: [string, "strong" | "em" | "del"][] = [
  ["**", "strong"],
  ["__", "strong"],
  ["~~", "del"],
  ["*", "em"],
  ["_", "em"],
];

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && /[\\`*_~[\]()#|>-]/.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    // Models put <br> in table cells for line breaks; it's the one HTML tag honoured.
    const br = ch === "<" ? /^<br\s*\/?>/i.exec(text.slice(i)) : null;
    if (br) {
      flush();
      out.push({ kind: "br" });
      i += br[0].length;
      continue;
    }

    if (ch === "`") {
      const ticks = text.slice(i).match(/^`+/)![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        flush();
        out.push({ kind: "code", text: text.slice(i + ticks.length, end).trim() });
        i = end + ticks.length;
        continue;
      }
    }

    if (ch === "[") {
      const link = /^\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
      if (link && /^https?:\/\//i.test(link[2])) {
        flush();
        out.push({ kind: "link", href: link[2], children: parseInline(link[1]) });
        i += link[0].length;
        continue;
      }
    }

    const emphasis = EMPHASIS.find(([mark]) => text.startsWith(mark, i));
    if (emphasis) {
      const [mark, kind] = emphasis;
      const end = closingIndex(text, i, mark);
      if (end > 0) {
        flush();
        out.push({ kind, children: parseInline(text.slice(i + mark.length, end)) });
        i = end + mark.length;
        continue;
      }
    }

    plain += ch;
    i++;
  }
  flush();
  return out;
}

// Where an emphasis opened at `start` closes, or -1. The opener must be
// followed by text, the closer preceded by it, and underscores must sit at
// word edges, so snake_case and "2 * 3 * 4" stay as they are.
function closingIndex(text: string, start: number, mark: string): number {
  const after = text[start + mark.length];
  if (!after || /\s/.test(after)) return -1;
  if (mark[0] === "_" && start > 0 && /\w/.test(text[start - 1])) return -1;
  let from = start + mark.length + 1;
  while (true) {
    const end = text.indexOf(mark, from);
    if (end < 0) return -1;
    const before = text[end - 1];
    const next = text[end + mark.length];
    const wordEdge = mark[0] !== "_" || !next || !/\w/.test(next);
    // A single * or _ next to another one belongs to a ** or __ pair.
    const partOfDouble = mark.length === 1 && (next === mark || text[end - 1] === mark);
    if (!/\s/.test(before) && wordEdge && !partOfDouble) return end;
    from = end + 1;
  }
}
