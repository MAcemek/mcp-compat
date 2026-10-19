import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HELP_TEXT, type CliOptions } from '../src/args.js';
import { runCli, shouldUseColor, type CliDeps } from '../src/cli-main.js';
import type { Report } from '../src/types.js';
import { VERSION } from '../src/version.js';
import { Capture, fixtureCommand } from './helpers/fixtures.js';

function setup(overrides: Partial<CliDeps> = {}) {
  const stdout = new Capture();
  const stderr = new Capture();
  const deps: CliDeps = {
    fetch: (input, init) => fetch(input, init),
    cwd: process.cwd(),
    env: {},
    stdout,
    stderr,
    ...overrides,
  };
  return { deps, stdout, stderr };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runCli', () => {
  it('prints help and the version', async () => {
    const help = setup();
    expect(await runCli(['--help'], help.deps)).toBe(0);
    expect(help.stdout.text).toBe(HELP_TEXT);
    const version = setup();
    expect(await runCli(['-v'], version.deps)).toBe(0);
    expect(version.stdout.text).toBe(`${VERSION}\n`);
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('exits 2 for usage errors', async () => {
    const { deps, stdout, stderr } = setup();
    expect(await runCli(['--url', 'ftp://x'], deps)).toBe(2);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe(
      'mcp-compat: Unsupported URL scheme "ftp:". Use http or https.\nRun "mcp-compat --help" for usage.\n',
    );
  });

  it('prints a JSON report and exits 0', async () => {
    const { deps, stdout, stderr } = setup();
    const code = await runCli(
      [
        '--stdio',
        fixtureCommand('dual'),
        '--versions',
        '2026-07-28,2025-11-25',
        '--format',
        'json',
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe('');
    const report = JSON.parse(stdout.text) as Report;
    expect(report.summary.connect).toBe('both');
    expect(report.versions).toEqual(['2026-07-28', '2025-11-25']);
  });

  it('writes the report to --output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-compat-cli-'));
    tempDirs.push(dir);
    const file = join(dir, 'report.md');
    const { deps, stdout, stderr } = setup();
    const code = await runCli(
      [
        '--stdio',
        fixtureCommand('modern'),
        '--versions',
        '2026-07-28',
        '--format',
        'markdown',
        '-o',
        file,
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe(`Report written to ${file}\n`);
    expect(readFileSync(file, 'utf8')).toMatch(/^## mcp-compat report\n/);
  });

  it('exits 1 when fail-on matches', async () => {
    const { deps, stderr } = setup();
    const code = await runCli(
      [
        '--stdio',
        fixtureCommand('legacy'),
        '--versions',
        '2026-07-28,2025-11-25',
        '--fail-on',
        'no-modern',
      ],
      deps,
    );
    expect(code).toBe(1);
    expect(stderr.text).toBe(
      'mcp-compat: fail-on matched: no-modern (modern-era clients (2026-07-28) cannot connect).\n',
    );
  });

  it('exits 3 when the server cannot be started', async () => {
    const { deps, stdout, stderr } = setup();
    expect(await runCli(['--stdio', fixtureCommand('crash')], deps)).toBe(3);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe(
      'mcp-compat: could not start the server: server exited with code 1 before answering server/discover (stderr: fatal: missing API key)\n',
    );
  });
});

describe('shouldUseColor', () => {
  const options: CliOptions = {
    target: { kind: 'stdio', command: 'x' },
    versions: ['2025-11-25'],
    timeoutMs: 1000,
    format: 'text',
    failOn: [],
    output: null,
    noColor: false,
  };

  it('uses color only for text on a terminal', () => {
    expect(shouldUseColor(options, setup({ stdout: new Capture(true) }).deps)).toBe(true);
    expect(shouldUseColor(options, setup({ stdout: new Capture(false) }).deps)).toBe(false);
    expect(
      shouldUseColor(options, setup({ stdout: new Capture(true), env: { NO_COLOR: '1' } }).deps),
    ).toBe(false);
    expect(
      shouldUseColor({ ...options, noColor: true }, setup({ stdout: new Capture(true) }).deps),
    ).toBe(false);
    expect(
      shouldUseColor({ ...options, format: 'json' }, setup({ stdout: new Capture(true) }).deps),
    ).toBe(false);
  });
});
