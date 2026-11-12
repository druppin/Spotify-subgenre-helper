import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

/** An AI answer's Markdown, as React elements (never raw HTML). */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2">{parseMarkdown(text).map(renderBlock)}</div>;
}

const HEADING_CLASS = ["text-[15px] font-bold text-ink", "text-[14px] font-bold text-ink", "text-[13px] font-semibold text-ink"];

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading":
      return (
        <p key={key} role="heading" aria-level={block.level} className={HEADING_CLASS[Math.min(block.level, 3) - 1]}>
          {renderInlines(block.children)}
        </p>
      );
    case "paragraph":
      return <p key={key}>{renderInlines(block.children)}</p>;
    case "code":
      return (
        <pre key={key} className="overflow-x-auto rounded-md border border-line bg-raised p-2 font-mono text-xs leading-5">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="space-y-2 border-l-2 border-line-strong pl-3 text-muted">
          {block.blocks.map(renderBlock)}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="space-y-1 pl-0.5">
          {item.map(renderBlock)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      );
    }
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className="border-b border-line-strong px-2 py-1 font-semibold" style={{ textAlign: block.align[i] ?? "left" }}>
                    {renderInlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-line">
                  {row.map((cell, i) => (
                    <td key={i} className="px-2 py-1 align-top" style={{ textAlign: block.align[i] ?? "left" }}>
                      {renderInlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={key} className="border-line" />;
  }
}

function renderInlines(inlines: Inline[]): ReactNode {
  return inlines.map((inline, i) => <Fragment key={i}>{renderInline(inline)}</Fragment>);
}

function renderInline(inline: Inline): ReactNode {
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "br":
      return <br />;
    case "code":
      return <code className="rounded bg-raised px-1 py-px font-mono text-[0.92em]">{inline.text}</code>;
    case "strong":
      return <strong className="font-semibold text-ink">{renderInlines(inline.children)}</strong>;
    case "em":
      return <em>{renderInlines(inline.children)}</em>;
    case "del":
      return <del>{renderInlines(inline.children)}</del>;
    case "link":
      return (
        <a href={inline.href} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
          {renderInlines(inline.children)}
        </a>
      );
  }
}
