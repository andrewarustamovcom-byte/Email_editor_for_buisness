// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ReviewSession } from '../../apps/extension/src/content/session';
import type { MailAdapter, Snapshot } from '../../apps/extension/src/adapters/mail';
import type { AnalyzeResponse } from '../../packages/contracts/src/index';
import { issue, model } from '../fixtures/data';
function setup(text = 'немедленно затем срочно') {
  const editor = document.createElement('div'); document.body.append(editor);
  let current: Snapshot = { editorId: 'e1', revision: 0, subject: '', text };
  const adapter: MailAdapter = {
    editors: () => [editor], activeEditor: () => editor, read: () => ({ ...current }), availableHistory: () => [], highlight: () => true, dispose: () => {},
    replace: (_editor, expected, start, end, replacement) => {
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('stale');
      current = { ...current, revision: current.revision + 1, text: current.text.slice(0, start) + replacement + current.text.slice(end) }; return { ...current };
    },
  };
  const issues = [issue(), issue({ id: 'tone-2', anchor: { quote: 'срочно', before: '', after: '' }, replacementText: 'по возможности' })];
  const result: AnalyzeResponse = { ...model(issues), schemaVersion: '1', promptVersion: '1.0.0', requestId: crypto.randomUUID(), editorId: 'e1', revision: 0, snapshotHash: 'a'.repeat(64), contextCoverage: 'none', contextNote: '', provider: 'mock' };
  return { session: new ReviewSession(editor, result, current, adapter), issues, read: () => current, edit: (text: string) => { current = { ...current, text, revision: current.revision + 1 }; } };
}
describe('safe review session', () => {
  it('rebases remaining anchors after own edits and supports sequential LIFO undo', () => {
    const { session, issues, read } = setup(); session.accept(issues[0]!); session.accept(issues[1]!);
    expect(read().text).toBe('пожалуйста затем по возможности');
    session.undo(); expect(read().text).toBe('пожалуйста затем срочно'); session.undo(); expect(read().text).toBe('немедленно затем срочно');
  });
  it('disables stale replacements and undo after user editing', () => {
    const { session, issues, edit } = setup(); session.accept(issues[0]!); edit('Пользовательский текст');
    expect(session.stale()).toBe(true); expect(() => session.accept(issues[1]!)).toThrow(); expect(() => session.undo()).toThrow();
  });
  it('rejects ambiguous locations and already processed issues', () => {
    const { session, issues } = setup('немедленно немедленно срочно'); expect(() => session.accept(issues[0]!)).toThrow();
    session.rejected.add(issues[1]!.id); expect(() => session.accept(issues[1]!)).toThrow();
  });
});
