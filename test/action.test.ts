import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readActionInputs, runAction, type ActionDeps } from '../src/action-main.js';
import { KNOWN_VERSIONS } from '../src/protocol.js';
import type { Report } from '../src/types.js';
import { fixtureCommand } from './helpers/fixtures.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(inputs: Record<string, string>) {
  const tempDir = mkdtempSync(join(tmpdir(), 'mcp-compat-action-'));
  tempDirs.push(tempDir);
  const result = {
    logs: [] as string[],
    secrets: [] as string[],
    summaries: [] as string[],
    outputs: {} as Record<string, string>,
    failures: [] as string[],
  };
  const deps: ActionDeps = {
    getInput: (name) => inputs[name] ?? '',
    fetch: (input, init) => fetch(input, init),
    cwd: process.cwd(),
    tempDir,
    info: (message) => result.logs.push(message),
    setSecret: (value) => result.secrets.push(value),
    writeSummary: async (markdown) => {
      result.summaries.push(markdown);
    },
    setOutput: (name, value) => {
      result.outputs[name] = value;
    },
    setFailed: (message) => result.failures.push(message),
  };
  return { deps, result, tempDir };
}

describe('readActionInputs', () => {
  it('applies defaults', () => {
    expect(readActionInputs((name) => (name === 'command' ? ' node server.js ' : ''))).toEqual({
      target: { kind: 'stdio', command: 'node server.js' },
      versions: [...KNOWN_VERSIONS],
      timeoutMs: 10_000,
      failOn: [],
    });
  });

  it('reads one header per line', () => {
    const inputs: Record<string, string> = {
      url: 'https://example.com/mcp',
      headers: 'Authorization: Bearer a\n\n  X-Team: blue  \n',
    };
    expect(readActionInputs((name) => inputs[name] ?? '').target).toEqual({
      kind: 'url',
      url: new URL('https://example.com/mcp'),
      headers: [
        { name: 'Authorization', value: 'Bearer a' },
        { name: 'X-Team', value: 'blue' },
      ],
    });
  });

  it('needs exactly one of command and url', () => {
    expect(() => readActionInputs(() => '')).toThrow('Use --stdio "<command>" or --url <url>.');
  });
});

describe('runAction', () => {
  it('logs the report, writes the summary and JSON, and sets outputs', async () => {
    const { deps, result, tempDir } = setup({
      command: fixtureCommand('dual'),
      versions: '2026-07-28,2025-11-25',
    });
    await runAction(deps);
    expect(result.failures).toEqual([]);
    expect(result.logs[0]).toMatch(/^mcp-compat 0\.1\.0\nTarget: node test\/fixtures/);
    expect(result.summaries[0]).toMatch(/^## mcp-compat report\n/);
    const reportPath = join(tempDir, 'mcp-compat-report.json');
    expect(result.outputs).toEqual({
      legacy: 'true',
      modern: 'true',
      connect: 'both',
      'server-name': 'dual-fixture',
      'server-version': '3.1.0',
      'matrix-json': JSON.stringify([
        {
          version: '2026-07-28',
          transport: 'stdio',
          status: 'works',
          negotiatedVersion: '2026-07-28',
          reason: '',
        },
        {
          version: '2025-11-25',
          transport: 'stdio',
          status: 'works',
          negotiatedVersion: '2025-11-25',
          reason: '',
        },
      ]),
      'report-json': reportPath,
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.summary.connect).toBe('both');
  });

  it('fails the run when fail-on matches', async () => {
    const { deps, result } = setup({
      command: fixtureCommand('legacy'),
      versions: '2026-07-28,2025-11-25',
      'fail-on': 'no-modern',
    });
    await runAction(deps);
    expect(result.failures).toEqual([
      'fail-on matched: no-modern (modern-era clients (2026-07-28) cannot connect).',
    ]);
    expect(result.outputs.legacy).toBe('true');
    expect(result.outputs.modern).toBe('false');
  });

  it('masks header values and fails for invalid inputs and unreachable servers', async () => {
    const invalid = setup({ command: 'x', 'fail-on': 'nope' });
    await runAction(invalid.deps);
    expect(invalid.result.failures).toEqual([
      'Unknown fail-on value "nope". Use no-modern, no-legacy, deprecated-transport, session-required, any-failure.',
    ]);

    const masked = setup({
      url: 'http://127.0.0.1:9/mcp',
      headers: 'X-Key: s3cret',
      timeout: '500',
    });
    await runAction(masked.deps);
    expect(masked.result.secrets).toEqual(['s3cret']);
    expect(masked.result.failures[0]).toMatch(/^could not reach http:\/\/127\.0\.0\.1:9\/mcp: /);
    expect(masked.result.outputs).toEqual({});

    const crash = setup({ command: fixtureCommand('crash') });
    await runAction(crash.deps);
    expect(crash.result.failures).toEqual([
      'could not start the server: server exited with code 1 before answering server/discover (stderr: fatal: missing API key)',
    ]);
  });
});
