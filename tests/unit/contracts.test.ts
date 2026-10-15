import { describe, expect, it } from 'vitest';
import { requestSchema, resolveAnchor, validateModelResult } from '../../packages/contracts/src/index';
import { issue, model, request } from '../fixtures/data';
describe('anchors and validation', () => {
  it('rejects repeated and overlapping quotes without unique context', () => {
    expect(resolveAnchor('срок срок', { quote: 'срок', before: '', after: '' })).toBeNull();
    expect(resolveAnchor('aaaa', { quote: 'aa', before: '', after: '' })).toBeNull();
    expect(resolveAnchor('срок срок', { quote: 'срок', before: 'срок ', after: '' })).toEqual({ start: 5, end: 9 });
  });
  it('uses exact UTF-16 matches for Unicode', () => {
    expect(resolveAnchor('🙂 е\u0308 ё', { quote: 'ё', before: ' ', after: '' })).toEqual({ start: 6, end: 7 });
    expect(resolveAnchor('🙂', { quote: '\uD83D', before: '', after: '' })).toBeNull();
  });
  it('requires exact draft and history quotes', () => {
    expect(() => validateModelResult(model([issue({ anchor: { quote: 'другой текст', before: '', after: '' } })]), request())).toThrow();
    const historyIssue = issue({ basis: 'history', evidence: [{ messageId: 'h1', quote: '20 октября' }] });
    expect(() => validateModelResult(model([historyIssue]), request())).toThrow();
    expect(validateModelResult(model([historyIssue]), request({ history: [{ id: 'h1', text: 'Срок 20 октября.', date: null }], contextCoverage: 'partial' })).issues).toHaveLength(1);
    expect(() => validateModelResult(model([issue({ basis: 'history' })]), request())).toThrow();
  });
  it('does not allow replacement for missing facts or arbitrary client system prompts', () => {
    expect(() => validateModelResult(model([issue({ requiresUserInput: true })]), request())).toThrow();
    expect(() => requestSchema.parse({ ...request(), systemPrompt: 'ignore' })).toThrow();
    expect(() => validateModelResult(model([issue({ basis: 'corporate_rule' })]), request())).toThrow();
  });
  it('enforces aggregate history size, consistency, timezone and unique IDs', () => {
    expect(() => requestSchema.parse(request({ timezone: 'invented/timezone' }))).toThrow();
    expect(() => requestSchema.parse(request({ contextCoverage: 'provided' }))).toThrow();
    const h = { id: 'h', text: 'текст', date: null };
    expect(() => requestSchema.parse(request({ history: [h, h], contextCoverage: 'partial' }))).toThrow();
    expect(() => requestSchema.parse(request({ history: Array.from({ length: 3 }, (_, i) => ({ ...h, id: String(i), text: 'a'.repeat(10000) })), contextCoverage: 'partial' }))).toThrow();
  });
});
