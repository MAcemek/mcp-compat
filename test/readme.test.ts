import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runDemo } from './helpers/demo.js';
import { Capture } from './helpers/fixtures.js';

function firstTextBlock(markdown: string): string {
  const match = /```text\n([\s\S]*?)```/.exec(markdown);
  if (!match?.[1]) throw new Error('README.md has no ```text block');
  return match[1];
}

describe('README', () => {
  it('shows the exact output of npm run demo', async () => {
    const stdout = new Capture();
    const code = await runDemo([], { stdout, stderr: new Capture(), env: {} });
    expect(code).toBe(0);
    expect(firstTextBlock(readFileSync('README.md', 'utf8'))).toBe(stdout.text);
  });

  it('contains only ASCII characters', () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\u0000-\u007f]*$/.test(readFileSync('README.md', 'utf8'))).toBe(true);
  });
});
