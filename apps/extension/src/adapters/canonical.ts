export interface Position { node: Text; offset: number }
export interface CanonicalText { text: string; starts: (Position | null)[]; ends: (Position | null)[] }
const excluded = '.gmail_signature, [data-smartmail="gmail_signature"], .gmail_quote, blockquote, [contenteditable="false"], script, style';
const blocks = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'PRE', 'SECTION', 'TABLE', 'TR']);

/** Exact UTF-16 text map: NBSP→space, CRLF/CR→LF, block boundaries→LF. No Unicode normalization. */
export function canonicalize(root: HTMLElement): CanonicalText {
  const chars: string[] = []; const starts: (Position | null)[] = []; const ends: (Position | null)[] = [];
  const line = () => { if (chars.length && chars.at(-1) !== '\n') { chars.push('\n'); starts.push(null); ends.push(null); } };
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      for (let i = 0; i < text.data.length; i++) {
        const start = i; let char = text.data[i]!;
        if (char === '\r') { char = '\n'; if (text.data[i + 1] === '\n') i++; }
        if (char === '\u00a0') char = ' ';
        chars.push(char); starts.push({ node: text, offset: start }); ends.push({ node: text, offset: i + 1 });
      }
    } else if (node instanceof HTMLElement) {
      if (node !== root && (node.matches(excluded) || node.hidden || node.getAttribute('aria-hidden') === 'true' || node.style.display === 'none')) return;
      if (node.tagName === 'BR') { chars.push('\n'); starts.push(null); ends.push(null); return; }
      const block = node !== root && blocks.has(node.tagName);
      if (block) line();
      node.childNodes.forEach(walk);
      if (block) line();
    }
  }
  walk(root);
  if (chars.at(-1) === '\n' && starts.at(-1) === null) { chars.pop(); starts.pop(); ends.pop(); }
  return { text: chars.join(''), starts, ends };
}

export function mappedRange(root: HTMLElement, start: number, end: number): Range | null {
  const mapped = canonicalize(root);
  const first = mapped.starts[start]; const last = mapped.ends[end - 1];
  if (start < 0 || end <= start || !first || !last) return null;
  const range = document.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
  return range;
}
