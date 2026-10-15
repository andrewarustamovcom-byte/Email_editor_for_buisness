import type { HistoryMessage } from '../../../../packages/contracts/src/index';
export interface Snapshot { editorId: string; revision: number; subject: string; text: string }
export interface MailAdapter {
  editors(): HTMLElement[];
  activeEditor(): HTMLElement | null;
  read(editor: HTMLElement): Snapshot;
  availableHistory(editor: HTMLElement): HistoryMessage[];
  highlight(editor: HTMLElement, start: number, end: number): boolean;
  readFragment?(editor: HTMLElement, start: number, end: number): string | null;
  replace(editor: HTMLElement, expected: Snapshot, start: number, end: number, replacement: string): Snapshot;
  dispose(): void;
}
