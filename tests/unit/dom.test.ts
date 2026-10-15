// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize, mappedRange } from '../../apps/extension/src/adapters/canonical';
import { GmailAdapter } from '../../apps/extension/src/adapters/gmail';
afterEach(() => { document.body.replaceChildren(); });
describe('canonical DOM', () => {
  it('maps block boundaries, NBSP and Unicode, excludes signatures and quoted history', () => {
    document.body.innerHTML = '<div id="editor"><div>🙂&nbsp;<b>текст</b></div><div>вторая<br>строка</div><div class="gmail_signature">Подпись</div><blockquote>История</blockquote></div>';
    const editor = document.getElementById('editor')!;
    expect(canonicalize(editor).text).toBe('🙂 текст\nвторая\nстрока');
    expect(mappedRange(editor, 3, 8)?.toString()).toBe('текст');
  });
  it('increments revision for edits even when text is restored between snapshots', async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">Исходный текст</div>';
    const editor = document.getElementById('editor')!; const adapter = new GmailAdapter();
    const original = adapter.read(editor);
    editor.firstChild!.textContent = 'Иной текст'; editor.firstChild!.textContent = 'Исходный текст';
    await Promise.resolve();
    expect(adapter.read(editor).revision).toBeGreaterThan(original.revision); adapter.dispose();
  });
});
