/**
 * Just enough Markdown to render the privacy notice (constants/privacyPolicy.ts)
 * without a dependency: headings, paragraphs, "- " bullets, pipe tables, and
 * inline **bold** / `placeholder` spans. Source lines are hard-wrapped, so
 * consecutive lines of a paragraph or bullet are joined with a space.
 *
 * ponytail: deliberately not a Markdown parser. Anything outside this subset
 * renders as plain paragraph text — add a case here if the policy grows one.
 */
export type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

export type Span = { text: string; bold?: boolean; placeholder?: boolean };

const cells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  let last: Block | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { last = null; continue; }
    if (line.startsWith('## ')) { out.push((last = { kind: 'h2', text: line.slice(3).trim() })); last = null; continue; }
    if (line.startsWith('# ')) { out.push({ kind: 'h1', text: line.slice(2).trim() }); last = null; continue; }
    if (line.trimStart().startsWith('|')) {
      if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue; // |---|---| separator
      if (last?.kind === 'table') last.rows.push(cells(line));
      else out.push((last = { kind: 'table', head: cells(line), rows: [] }));
      continue;
    }
    if (line.startsWith('- ')) { out.push((last = { kind: 'li', text: line.slice(2).trim() })); continue; }
    if (last && (last.kind === 'p' || last.kind === 'li')) { last.text += ' ' + line.trim(); continue; }
    out.push((last = { kind: 'p', text: line.trim() }));
  }
  return out;
}

/** Split inline text into plain / **bold** / `placeholder` runs. */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) });
    spans.push(m[1] != null ? { text: m[1], bold: true } : { text: m[2], placeholder: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}
