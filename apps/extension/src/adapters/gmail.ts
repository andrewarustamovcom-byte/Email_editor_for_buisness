import { canonicalize, mappedRange } from './canonical';
import type { MailAdapter, Snapshot } from './mail';
import type { HistoryMessage } from '../../../../packages/contracts/src/index';
interface EditorState { id: string; revision: number; subject: string; text: string; observer: MutationObserver }
export class GmailAdapter implements MailAdapter {
  private states = new Map<HTMLElement, EditorState>();
  private last: HTMLElement | null = null;
  private focus = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      const editor = this.editors().find(e => e === target || e.contains(target));
      if (editor) this.last = editor;
    }
  };
  constructor() { document.addEventListener('focusin', this.focus); }
  editors() {
    for (const [editor, state] of this.states) if (!editor.isConnected) { state.observer.disconnect(); this.states.delete(editor); }
    return Array.from(document.querySelectorAll<HTMLElement>('div[contenteditable="true"][role="textbox"]'))
      .filter(e => e.getClientRects().length > 0 && !e.closest('[data-pisma-panel]') && !e.closest('[aria-hidden="true"]'));
  }
  activeEditor() {
    const editors = this.editors();
    return (this.last && editors.includes(this.last) ? this.last : editors.length === 1 ? editors[0] : null) ?? null;
  }
  private subject(editor: HTMLElement) {
    const container = editor.closest('[role="dialog"], .M9, form') ?? editor.parentElement;
    const input = container?.querySelector<HTMLInputElement>('input[name="subjectbox"], input[name="subject"]');
    return input?.value ?? '';
  }
  read(editor: HTMLElement): Snapshot {
    if (!editor.isConnected) throw new Error('Черновик закрыт. Выберите открытый редактор.');
    const text = canonicalize(editor).text; const subject = this.subject(editor);
    let state = this.states.get(editor);
    if (!state) {
      const observer = new MutationObserver(records => {
        const tracked = this.states.get(editor);
        if (tracked && records.length && editor.isConnected) {
          tracked.revision++; tracked.text = canonicalize(editor).text; tracked.subject = this.subject(editor);
        }
      });
      state = { id: crypto.randomUUID(), revision: 0, text, subject, observer };
      this.states.set(editor, state); observer.observe(editor, { subtree: true, childList: true, characterData: true, attributes: true });
    } else {
      const mutated = state.observer.takeRecords().length > 0;
      if (mutated || state.text !== text || state.subject !== subject) {
        state.revision++; state.text = text; state.subject = subject;
      }
    }
    return { editorId: state.id, revision: state.revision, text, subject };
  }
  availableHistory(editor: HTMLElement): HistoryMessage[] {
    const messages: HistoryMessage[] = []; const ids = new Set<string>();
    for (const body of document.querySelectorAll<HTMLElement>('[data-message-id] .a3s, [data-legacy-message-id] .a3s')) {
      if (messages.length >= 10) break;
      if (!body.getClientRects().length || body.contains(editor) || editor.contains(body) || body.closest('[role="dialog"]')) continue;
      const parent = body.closest('[data-message-id], [data-legacy-message-id]');
      const id = parent?.getAttribute('data-message-id') ?? parent?.getAttribute('data-legacy-message-id');
      if (!id || ids.has(id)) continue;
      const text = canonicalize(body).text;
      if (!text || text.length > 12000) continue;
      const datetime = parent?.querySelector('time[datetime]')?.getAttribute('datetime');
      messages.push({ id: id.slice(0, 160), text, date: datetime && Number.isFinite(Date.parse(datetime)) ? new Date(datetime).toISOString() : null });
      ids.add(id);
    }
    return messages;
  }
  highlight(editor: HTMLElement, start: number, end: number) {
    const range = mappedRange(editor, start, end); if (!range) return false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' }); editor.focus();
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    return true;
  }
  readFragment(editor: HTMLElement, start: number, end: number) { return mappedRange(editor, start, end)?.toString() ?? null; }
  replace(editor: HTMLElement, expected: Snapshot, start: number, end: number, replacement: string) {
    const current = this.read(editor);
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Письмо изменилось. Проверьте его повторно.');
    const range = mappedRange(editor, start, end);
    if (!range || range.startContainer !== range.endContainer || /[\r\n]/.test(replacement) || /[\r\n]/.test(range.toString()) ||
        !document.queryCommandSupported('insertText'))
      throw new Error('Эту правку безопаснее вставить вручную: скопируйте вариант. Форматирование сохранено.');
    const selection = window.getSelection(); editor.focus(); selection?.removeAllRanges(); selection?.addRange(range);
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: replacement });
    if (!editor.dispatchEvent(event)) throw new Error('Редактор отклонил изменение. Скопируйте вариант вручную.');
    // beforeinput handlers can modify DOM; revalidate before native editor operation.
    if (JSON.stringify(this.read(editor)) !== JSON.stringify(expected)) throw new Error('Письмо изменилось перед заменой. Проверьте его повторно.');
    selection?.removeAllRanges(); selection?.addRange(range);
    const expectedText = current.text.slice(0, start) + replacement.replace(/\u00a0/g, ' ') + current.text.slice(end);
    const success = document.execCommand('insertText', false, replacement);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
    const result = this.read(editor);
    if (!success || result.text !== expectedText) throw new Error('Редактор не подтвердил точную замену. Проверьте черновик и запустите анализ снова.');
    return result;
  }
  dispose() { document.removeEventListener('focusin', this.focus); for (const s of this.states.values()) s.observer.disconnect(); this.states.clear(); }
}
