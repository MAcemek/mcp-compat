import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { UnreachableError } from '../src/errors.js';
import { formatJson } from '../src/format/index.js';
import { formatMarkdown } from '../src/format/markdown.js';
import { formatText } from '../src/format/text.js';
import {
  startFixtureServer,
  type FixtureServer,
  type HttpProfile,
} from './fixtures/servers/http-server.mjs';
import { matrix, probe, probeUrl } from './helpers/fixtures.js';

const servers: FixtureServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function start(
  profile: HttpProfile,
  options?: { token?: string; echoSession?: boolean },
): Promise<FixtureServer> {
  const server = await startFixtureServer(profile, options);
  servers.push(server);
  return server;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe('HTTP probes', () => {
  it('stateless dual-era server: both eras over Streamable HTTP, no sessions', async () => {
    const server = await start('dual');
    const report = await probeUrl(server.url);
    expect(matrix(report)).toEqual([
      '2026-07-28 streamable-http works',
      '2026-07-28 http-sse not-applicable',
      '2025-11-25 streamable-http works',
      '2025-11-25 http-sse fails',
      '2025-06-18 streamable-http works',
      '2025-06-18 http-sse fails',
      '2025-03-26 streamable-http works',
      '2025-03-26 http-sse fails',
      '2024-11-05 streamable-http negotiated:2025-11-25',
      '2024-11-05 http-sse fails',
    ]);
    expect(probe(report, '2026-07-28', 'http-sse').reason).toBe(
      '2026-07-28 does not define HTTP+SSE',
    );
    expect(probe(report, '2025-11-25', 'http-sse')).toMatchObject({
      reason: 'GET returned HTTP 405',
      httpStatus: 405,
      failure: 'http',
    });
    expect(probe(report, '2025-11-25', 'streamable-http').session).toBe('none');
    expect(report.summary).toEqual({
      legacy: true,
      modern: true,
      connect: 'both',
      deprecatedTransport: false,
      session: 'none',
    });
    expect(report.hints).toEqual([]);

    const modern = server.requests.filter((r) => r.rpcMethod === 'server/discover');
    expect(modern[0]).toMatchObject({
      protocolVersion: '2026-07-28',
      mcpMethod: 'server/discover',
    });
    const init = server.requests.find((r) => r.rpcMethod === 'initialize');
    expect(init).toMatchObject({ protocolVersion: null, mcpMethod: null });
    const legacyList = server.requests.find(
      (r) => r.rpcMethod === 'tools/list' && r.mcpMethod === null,
    );
    expect(legacyList?.protocolVersion).toBe('2025-11-25');
  });

  it('session server: flags the session requirement, answers server requests, ends sessions', async () => {
    const server = await start('legacy-session');
    const report = await probeUrl(server.url);
    expect(probe(report, '2026-07-28', 'streamable-http').reason).toBe(
      'server/discover returned HTTP 400 with error -32000: Bad Request: Mcp-Session-Id header is required',
    );
    expect(probe(report, '2025-11-25', 'streamable-http')).toMatchObject({
      status: 'works',
      session: 'required',
      counts: { tools: 2, resources: null, prompts: 1 },
    });
    expect(report.summary.session).toBe('required');
    expect(report.hints.map((h) => h.id)).toEqual(['add-modern', 'session-required']);

    const replies = server.requests.filter((r) => r.id === 'server-sampling-1');
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((r) => r.error === -32601 && r.session !== null)).toBe(true);
    const deletes = server.requests.filter((r) => r.httpMethod === 'DELETE');
    expect(deletes).toHaveLength(4);
  });

  it('HTTP+SSE server: works on the deprecated transport only', async () => {
    const server = await start('sse-only');
    const report = await probeUrl(server.url);
    expect(matrix(report)).toEqual([
      '2026-07-28 streamable-http fails',
      '2026-07-28 http-sse not-applicable',
      '2025-11-25 streamable-http fails',
      '2025-11-25 http-sse negotiated:2024-11-05',
      '2025-06-18 streamable-http fails',
      '2025-06-18 http-sse negotiated:2024-11-05',
      '2025-03-26 streamable-http fails',
      '2025-03-26 http-sse negotiated:2024-11-05',
      '2024-11-05 streamable-http fails',
      '2024-11-05 http-sse works',
    ]);
    expect(probe(report, '2024-11-05', 'streamable-http').reason).toBe(
      'initialize returned HTTP 405',
    );
    expect(report.summary.deprecatedTransport).toBe(true);
    expect(report.hints.map((h) => h.id)).toEqual(['add-modern', 'update-legacy', 'sse-only']);
  });

  it('modern-only server: legacy initialize gets the supported versions', async () => {
    const server = await start('modern');
    const report = await probeUrl(server.url, { versions: ['2026-07-28', '2025-11-25'] });
    expect(probe(report, '2026-07-28', 'streamable-http').status).toBe('works');
    expect(probe(report, '2025-11-25', 'streamable-http').reason).toBe(
      'initialize returned HTTP 400 with error -32022: Unsupported protocol version: 2025-11-25. This server supports 2026-07-28. (supported: 2026-07-28)',
    );
    expect(report.hints.map((h) => h.id)).toEqual(['keep-legacy']);
  });

  it('sends --header values and never prints them', async () => {
    const secret = 'test-secret-123';
    const server = await start('dual', { token: secret });
    const denied = await probeUrl(server.url, { versions: ['2026-07-28', '2025-11-25'] });
    expect(probe(denied, '2026-07-28', 'streamable-http')).toMatchObject({
      reason: 'server/discover returned HTTP 401',
      httpStatus: 401,
      reached: true,
    });
    expect(denied.hints.map((h) => h.id)).toEqual(['auth']);

    const report = await probeUrl(`${server.url}?key=${secret}`, {
      versions: ['2026-07-28', '2025-11-25'],
      headers: [{ name: 'Authorization', value: `Bearer ${secret}` }],
    });
    expect(report.summary.connect).toBe('both');
    expect(report.target).toEqual({
      kind: 'url',
      url: `${server.url}?key=***`,
      headers: ['Authorization'],
    });
    for (const output of [
      formatText(report, { color: false }),
      formatMarkdown(report),
      formatJson(report),
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('warns when a 2026-07-28 response carries Mcp-Session-Id', async () => {
    const server = await start('dual', { echoSession: true });
    const report = await probeUrl(server.url, { versions: ['2026-07-28'] });
    expect(report.warnings).toEqual([
      { id: 'session-on-modern', text: 'server sent Mcp-Session-Id on a 2026-07-28 response' },
    ]);
    expect(report.hints.map((h) => h.id)).toEqual(['session-on-modern']);
  });

  it('throws UnreachableError when nothing answers', async () => {
    const port = await freePort();
    const error = await probeUrl(`http://127.0.0.1:${port}/mcp`, {
      versions: ['2025-11-25'],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreachableError);
    expect((error as Error).message).toBe(
      `could not reach http://127.0.0.1:${port}/mcp: could not connect: ECONNREFUSED`,
    );
  });
});
