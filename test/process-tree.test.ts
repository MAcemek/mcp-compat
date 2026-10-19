import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProbe } from '../src/probe.js';
import { runningProcessCount } from '../src/transports/process-tree.js';
import { StdioChannel } from '../src/transports/stdio.js';
import { fixtureCommand } from './helpers/fixtures.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe('process cleanup', () => {
  it('kills the server and everything it started when a probe times out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-compat-tree-'));
    tempDirs.push(dir);
    const pidFile = join(dir, 'grandchild.pid');
    const channel = new StdioChannel({
      command: fixtureCommand('spawn-child', `"${pidFile}"`),
      cwd: process.cwd(),
      timeoutMs: 1500,
    });
    const result = await runProbe(channel, '2025-11-25');
    expect(result.failure).toBe('timeout');
    expect(result.reason).toBe('no response to initialize within 1500 ms');
    expect(result.reached).toBe(true);
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    expect(isAlive(grandchild)).toBe(true);
    await channel.close();
    expect(await waitUntil(() => !isAlive(grandchild), 5000)).toBe(true);
    expect(runningProcessCount()).toBe(0);
  });

  it('stops a server that ignores the end of stdin', async () => {
    const channel = new StdioChannel({
      command: fixtureCommand('hang'),
      cwd: process.cwd(),
      timeoutMs: 300,
      graceMs: 300,
    });
    const result = await runProbe(channel, '2026-07-28');
    expect(result.reason).toBe('no response to server/discover within 300 ms');
    await channel.close();
    expect(runningProcessCount()).toBe(0);
  });
});
