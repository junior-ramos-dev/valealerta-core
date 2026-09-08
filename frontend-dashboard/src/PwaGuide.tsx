import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type MdBlock =
  | { kind: "h"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "pre"; code: string }
  | { kind: "hr" };

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function parseBlocks(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  const takeFenced = (): string => {
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !lines[i].trim().startsWith("```")) {
      body.push(lines[i]);
      i += 1;
    }
    if (i < lines.length) i += 1;
    return body.join("\n");
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      blocks.push({ kind: "pre", code: takeFenced() });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      const text = heading[2].trim();
      blocks.push({ kind: "h", level, text, id: slugify(text) });
      i += 1;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+\.\s+/, "");
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (next.trim() === "") {
            item += "\n";
            i += 1;
            continue;
          }
          if (
            /^\s*\d+\.\s+/.test(next) ||
            /^\s*[-*]\s+/.test(next) ||
            next.startsWith("#") ||
            next.trim() === "---" ||
            next.trim().startsWith("|")
          ) {
            break;
          }
          if (next.trim().startsWith("```")) {
            item += `\n\`\`\`\n${takeFenced()}\`\`\``;
            continue;
          }
          if (/^\s{2,}/.test(next) || next.startsWith("   ")) {
            item += `\n${next.trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        items.push(item.trim());
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      lines[i].trim() !== "---" &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("|") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${n}`;
    n += 1;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2];
        const label = link[1];
        if (href.startsWith("#")) {
          nodes.push(
            <a key={key} href={href} onClick={(event) => event.stopPropagation()}>
              {label}
            </a>,
          );
        } else {
          nodes.push(
            <a key={key} href={href} target="_blank" rel="noreferrer">
              {label}
            </a>,
          );
        }
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderItem(text: string, key: string): ReactNode {
  const fence = text.match(/^([\s\S]*?)```\n?([\s\S]*?)```([\s\S]*)$/);
  if (!fence) return <>{renderInline(text, key)}</>;
  return (
    <>
      {fence[1].trim() ? <span>{renderInline(fence[1].trim(), `${key}-a`)}</span> : null}
      <pre>
        <code>{fence[2].replace(/^\n/, "")}</code>
      </pre>
      {fence[3].trim() ? <span>{renderInline(fence[3].trim(), `${key}-b`)}</span> : null}
    </>
  );
}

function MarkdownDoc({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="pwa-guide-md">
      {blocks.map((block, index) => {
        if (block.kind === "h") {
          const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
          return (
            <Tag key={index} id={block.id}>
              {renderInline(block.text, `h${index}`)}
            </Tag>
          );
        }
        if (block.kind === "p") {
          return <p key={index}>{renderInline(block.text, `p${index}`)}</p>;
        }
        if (block.kind === "hr") return <hr key={index} />;
        if (block.kind === "pre") {
          return (
            <pre key={index}>
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderItem(item, `u${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderItem(item, `o${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <div key={index} className="pwa-guide-table-wrap">
            <table>
              <thead>
                <tr>
                  {block.headers.map((cell) => (
                    <th key={cell}>{renderInline(cell, `th-${cell}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderInline(cell, `td${rowIndex}-${cellIndex}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

let pwaMarkdownCache: string | null = null;

async function loadPwaMarkdown(): Promise<string> {
  if (pwaMarkdownCache) return pwaMarkdownCache;
  const res = await fetch("/PWA.md");
  if (!res.ok) throw new Error("PWA.md indisponível.");
  pwaMarkdownCache = await res.text();
  return pwaMarkdownCache;
}

export function PwaGuideDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [source, setSource] = useState<string | null>(pwaMarkdownCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void loadPwaMarkdown()
      .then((text) => {
        if (!cancelled) setSource(text);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Não deu para abrir o guia PWA. Tente de novo com internet.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="pwa-guide-overlay" onClick={onClose} role="presentation">
      <div
        className="pwa-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pwa-guide-bar">
          <h2 id={titleId}>Baixar a bacia — o que isso faz</h2>
          <button type="button" className="pwa-guide-close" onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="pwa-guide-body">
          {error && <p className="pwa-guide-error">{error}</p>}
          {!error && !source && <p className="pwa-guide-error">Carregando guia…</p>}
          {source && <MarkdownDoc source={source} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
