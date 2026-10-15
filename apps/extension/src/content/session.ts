import { resolveAnchor, type AnalyzeResponse, type Issue } from '../../../../packages/contracts/src/index';
import type { MailAdapter, Snapshot } from '../adapters/mail';
export async function snapshotHash(snapshot: Pick<Snapshot, 'subject' | 'text'>) {
  const bytes = new TextEncoder().encode(JSON.stringify({ subject: snapshot.subject, text: snapshot.text }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
}
type Location = { start: number; end: number } | null;
interface Applied { issueId: string; start: number; old: string; replacement: string; anchors: Map<string, Location> }
export class ReviewSession {
  readonly rejected = new Set<string>();
  readonly applied: Applied[] = [];
  private expected: Snapshot;
  private anchors = new Map<string, Location>();
  constructor(readonly editor: HTMLElement, readonly result: AnalyzeResponse, snapshot: Snapshot, private adapter: MailAdapter) {
    this.expected = snapshot;
    if (result.editorId !== snapshot.editorId || result.revision !== snapshot.revision) throw new Error('Ответ относится к другому черновику.');
    for (const issue of result.issues) this.anchors.set(issue.id, issue.anchor ? resolveAnchor(snapshot.text, issue.anchor) : null);
  }
  stale() {
    try { return JSON.stringify(this.adapter.read(this.editor)) !== JSON.stringify(this.expected); } catch { return true; }
  }
  location(issue: Issue) {
    const location = this.anchors.get(issue.id);
    return !this.stale() && issue.anchor && location && this.expected.text.slice(location.start, location.end) === issue.anchor.quote ? location : null;
  }
  accept(issue: Issue) {
    if (this.rejected.has(issue.id) || this.applied.some(a => a.issueId === issue.id)) throw new Error('Правка уже обработана.');
    const location = this.location(issue);
    if (issue.suggestion !== 'replace' || !issue.replacementText || !location) throw new Error('Нет однозначной безопасной замены. Скопируйте предложение или проверьте письмо снова.');
    const previous = this.expected;
    const originalText = this.adapter.readFragment?.(this.editor, location.start, location.end) ?? issue.anchor!.quote;
    this.expected = this.adapter.replace(this.editor, previous, location.start, location.end, issue.replacementText);
    const anchors = new Map(this.anchors);
    const delta = issue.replacementText.length - (location.end - location.start);
    for (const [id, position] of this.anchors) {
      if (!position) continue;
      if (position.start >= location.end) this.anchors.set(id, { start: position.start + delta, end: position.end + delta });
      else if (position.end > location.start) this.anchors.set(id, null);
    }
    this.applied.push({ issueId: issue.id, start: location.start, old: originalText, replacement: issue.replacementText, anchors });
  }
  undo() {
    if (this.stale()) throw new Error('После правки письмо изменилось. Автоматическая отмена недоступна.');
    const last = this.applied.at(-1); if (!last) return;
    this.expected = this.adapter.replace(this.editor, this.expected, last.start, last.start + last.replacement.length, last.old);
    this.anchors = last.anchors;
    this.applied.pop();
  }
}
