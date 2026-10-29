import type { ReactNode } from "react";
import styles from "./MessageBody.module.css";

type Block =
  | { type: "p"; text: string }
  | { type: "code"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "h"; level: number; text: string };

/** Minimal markdown: paragraphs, lists, quotes, headings, fenced/inline code, bold/italic. */
export function MessageBody({ content }: { content: string }) {
  return (
    <div className={styles.body}>
      {parse(content).map((b, i) => {
        switch (b.type) {
          case "code":
            return (
              <pre key={i} className={styles.code}>
                <code>{b.text}</code>
              </pre>
            );
          case "ul":
          case "ol": {
            const List = b.type;
            return (
              <List key={i} className={styles.list}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className={styles.quote}>
                {inline(b.text)}
              </blockquote>
            );
          case "h":
            return (
              <p key={i} className={styles.h}>
                {inline(b.text)}
              </p>
            );
          default:
            return (
              <p key={i} className={styles.p}>
                {inline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

function parse(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: "p", text: para.join("\n") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      out.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const items = [(bullet ?? numbered)![1]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].match(kind === "ul" ? /^\s*[-*•]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/);
        if (!next) break;
        items.push(next[1]);
        i++;
      }
      out.push({ type: kind, items });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      out.push({ type: "h", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      flush();
      out.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

// Only http(s) ever becomes an href — model output must not be able to inject javascript: links.
const MD_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/;
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

function link(href: string, label: ReactNode, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className={styles.link}>
      {label}
    </a>
  );
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    let t = m[0];
    const md = t.match(MD_LINK);
    if (md) {
      nodes.push(link(md[2], md[1], key++));
      last = m.index + t.length;
      continue;
    }
    if (t.startsWith("http")) {
      const trail = t.match(TRAILING_PUNCT)?.[0] ?? "";
      t = t.slice(0, t.length - trail.length);
      nodes.push(link(t, t.replace(/^https?:\/\/(www\.)?/, ""), key++));
      last = m.index + t.length;
      continue;
    }
    if (t.startsWith("**")) nodes.push(<strong key={key++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`"))
      nodes.push(
        <code key={key++} className={styles.inline}>
          {t.slice(1, -1)}
        </code>
      );
    else nodes.push(<em key={key++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
