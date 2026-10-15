import { z } from 'zod';

export const categories = ['action', 'structure', 'deadline', 'agreements', 'tone'] as const;
export const categoryLabels: Record<Category, string> = {
  action: 'Ясность действия', structure: 'Структура и контекст', deadline: 'Срок',
  agreements: 'Договорённости', tone: 'Тон и обещания',
};
export const categorySchema = z.enum(categories);
export type Category = z.infer<typeof categorySchema>;
export const coverageSchema = z.enum(['none', 'partial', 'provided']);
export const historySchema = z.object({
  id: z.string().min(1).max(160), text: z.string().min(1).max(12000),
  date: z.string().max(100).nullable(),
}).strict();
export const requestSchema = z.object({
  requestId: z.uuid(), editorId: z.string().min(1).max(100), revision: z.int().nonnegative(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  subject: z.string().max(1000), text: z.string().min(1).max(20000),
  history: z.array(historySchema).max(10), contextCoverage: coverageSchema,
  language: z.enum(['ru', 'en']), currentDate: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
  settings: z.object({ categories: z.array(categorySchema).min(1).max(5) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.history.reduce((n, m) => n + m.text.length, 0) > 24000)
    ctx.addIssue({ code: 'custom', message: 'История превышает 24000 символов' });
  if ((value.history.length === 0) !== (value.contextCoverage === 'none'))
    ctx.addIssue({ code: 'custom', message: 'Несогласованная полнота истории' });
  if (new Set(value.history.map(m => m.id)).size !== value.history.length)
    ctx.addIssue({ code: 'custom', message: 'Повторяющиеся идентификаторы истории' });
});
export type AnalyzeRequest = z.infer<typeof requestSchema>;
export type HistoryMessage = z.infer<typeof historySchema>;
export const anchorSchema = z.object({
  quote: z.string().min(1).max(2000), before: z.string().max(200), after: z.string().max(200),
}).strict();
export type Anchor = z.infer<typeof anchorSchema>;
export const issueSchema = z.object({
  id: z.string().min(1).max(80), category: categorySchema,
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string().min(1).max(200), explanation: z.string().min(1).max(2000),
  basis: z.enum(['draft', 'history', 'corporate_rule']),
  anchor: anchorSchema.nullable(), suggestion: z.enum(['replace', 'insert', 'question']),
  replacementText: z.string().min(1).max(4000).nullable(),
  question: z.string().min(1).max(1000).nullable(), requiresUserInput: z.boolean(),
  evidence: z.array(z.object({ messageId: z.string().max(160), quote: z.string().min(1).max(2000) }).strict()).max(10),
}).strict();
export type Issue = z.infer<typeof issueSchema>;
export const statusSchema = z.enum(['clear', 'issues', 'insufficient', 'not_applicable']);
export const modelResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  categories: z.object({
    action: statusSchema, structure: statusSchema, deadline: statusSchema,
    agreements: statusSchema, tone: statusSchema,
  }).strict(),
  issues: z.array(issueSchema).max(20),
}).strict();
export type ModelResult = z.infer<typeof modelResultSchema>;
export const responseSchema = modelResultSchema.extend({
  schemaVersion: z.literal('1'), promptVersion: z.literal('1.0.0'),
  requestId: z.uuid(), editorId: z.string(), revision: z.int().nonnegative(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), contextCoverage: coverageSchema,
  contextNote: z.string().max(1000), provider: z.enum(['mock', 'yandex', 'groq']),
}).strict();
export type AnalyzeResponse = z.infer<typeof responseSchema>;
export const modelJsonSchema = z.toJSONSchema(modelResultSchema);

/** UTF-16 offsets, exact matching; model-supplied numeric offsets are never accepted. */
export function resolveAnchor(text: string, anchor: Anchor): { start: number; end: number } | null {
  const matches: number[] = [];
  for (let index = text.indexOf(anchor.quote); index !== -1; index = text.indexOf(anchor.quote, index + 1)) {
    const splitsSurrogate = (offset: number) => offset > 0 && offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
    if (splitsSurrogate(index) || splitsSurrogate(index + anchor.quote.length)) continue;
    if ((!anchor.before || text.slice(0, index).endsWith(anchor.before)) &&
        (!anchor.after || text.slice(index + anchor.quote.length).startsWith(anchor.after))) matches.push(index);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? { start: matches[0]!, end: matches[0]! + anchor.quote.length } : null;
}

export function validateModelResult(raw: unknown, request: AnalyzeRequest): ModelResult {
  const result = modelResultSchema.parse(raw);
  if (new Set(result.issues.map(i => i.id)).size !== result.issues.length) throw new Error('Duplicate issue IDs');
  for (const issue of result.issues) {
    if (!request.settings.categories.includes(issue.category)) throw new Error('Disabled category');
    if (issue.anchor && !request.text.includes(issue.anchor.quote)) throw new Error('Unverified draft quote');
    if (issue.basis === 'corporate_rule') throw new Error('No corporate rules configured');
    if (issue.evidence.some(e => !request.history.some(m => m.id === e.messageId && m.text.includes(e.quote))))
      throw new Error('Unverified history evidence');
    if (issue.basis === 'history' && issue.evidence.length === 0) throw new Error('Missing history evidence');
    if (issue.suggestion === 'replace' && (!issue.anchor || !issue.replacementText || issue.requiresUserInput || issue.question))
      throw new Error('Unsafe replacement');
    if (issue.suggestion === 'insert' && (issue.anchor || !issue.replacementText || issue.requiresUserInput || issue.question))
      throw new Error('Unsafe insertion');
    if (issue.suggestion === 'question' && (!issue.question || !issue.requiresUserInput || issue.replacementText !== null))
      throw new Error('Invalid question');
  }
  for (const category of categories) {
    const hasIssues = result.issues.some(i => i.category === category);
    if (hasIssues) result.categories[category] = 'issues';
    else if (result.categories[category] === 'issues') throw new Error('Missing issues for category');
    if (!request.settings.categories.includes(category)) result.categories[category] = 'not_applicable';
  }
  if (request.contextCoverage === 'none') result.categories.agreements = 'insufficient';
  return result;
}
