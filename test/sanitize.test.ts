import { describe, expect, it } from 'vitest';
import { cleanText, displayUrl } from '../src/sanitize.js';

describe('cleanText', () => {
  it('removes control characters and collapses whitespace', () => {
    expect(cleanText('a\u001b]0;title\u0007b\n\n c')).toBe('a ]0;title b c');
  });

  it('cuts long text', () => {
    expect(cleanText('x'.repeat(50), 10)).toBe('xxxxxxx...');
    expect(cleanText(42)).toBe('42');
  });
});

describe('displayUrl', () => {
  it('removes credentials and hides query values', () => {
    expect(displayUrl(new URL('https://user:pass@example.com/mcp?token=abc&x=1#frag'))).toBe(
      'https://example.com/mcp?token=***&x=***',
    );
    expect(displayUrl(new URL('http://127.0.0.1:3000/mcp'))).toBe('http://127.0.0.1:3000/mcp');
  });
});
