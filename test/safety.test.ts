import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NOTIFICATION_METHODS, REQUEST_METHODS } from '../src/protocol.js';
import { startFixtureServer, type FixtureServer } from './fixtures/servers/http-server.mjs';
import { probeStdio, probeUrl } from './helpers/fixtures.js';

/** Everything mcp-compat may send, plus "response" for replies to server requests. */
const ALLOWED = new Set<string>([...REQUEST_METHODS, ...NOTIFICATION_METHODS, 'response']);

const FORBIDDEN = [
  'tools/call',
  'resources/read',
  'prompts/get',
  'completion/complete',
  'resources/subscribe',
  'subscriptions/listen',
  'logging/setLevel',
  'tasks/',
];

const tempDirs: string[] = [];
const servers: FixtureServer[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) await server.close();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('safety', () => {
  it('sends only lifecycle, discovery and list methods over stdio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-compat-safety-'));
    tempDirs.push(dir);
    const log = join(dir, 'methods.log');
    await probeStdio('dual', { extra: ['--log', `"${log}"`] });
    await probeStdio('legacy', { extra: ['--log', `"${log}"`] });
    const methods = new Set(
      readFileSync(log, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l !== ''),
    );
    expect(methods.size).toBeGreaterThan(3);
    for (const method of methods) expect(ALLOWED.has(method), method).toBe(true);
  });

  it('sends only lifecycle, discovery and list methods over HTTP', async () => {
    for (const profile of ['dual', 'legacy-session', 'sse-only'] as const) {
      const server = await startFixtureServer(profile);
      servers.push(server);
      await probeUrl(server.url);
      for (const request of server.requests) {
        expect(ALLOWED.has(request.rpcMethod ?? 'response'), String(request.rpcMethod)).toBe(true);
        expect(['GET', 'POST', 'DELETE']).toContain(request.httpMethod);
      }
    }
  });

  it('has no code path that names a method with side effects', () => {
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const method of FORBIDDEN) {
        expect(text.includes(method), `${file}: ${method}`).toBe(false);
      }
    }
  });
});
