import { describe, expect, it } from 'vitest';
import { UnreachableError } from '../src/errors.js';
import { matrix, probe, probeStdio } from './helpers/fixtures.js';

describe('stdio probes', () => {
  it('legacy server: works for its versions, negotiates the rest, fails 2026-07-28', async () => {
    const report = await probeStdio('legacy');
    expect(matrix(report)).toEqual([
      '2026-07-28 stdio fails',
      '2025-11-25 stdio works',
      '2025-06-18 stdio works',
      '2025-03-26 stdio negotiated:2025-11-25',
      '2024-11-05 stdio negotiated:2025-11-25',
    ]);
    expect(probe(report, '2026-07-28')).toMatchObject({
      failure: 'rpc-error',
      errorCode: -32601,
      reason: 'server/discover returned error -32601: Method not found',
      reached: true,
    });
    // tools/list is paginated (2 + 1) and only answered after the client answered a ping.
    expect(probe(report, '2025-11-25')).toMatchObject({
      counts: { tools: 3, resources: 1, prompts: 2 },
      capabilities: ['prompts', 'resources', 'tools'],
      serverInfo: { name: 'legacy-fixture', version: '1.4.0' },
      session: null,
      warnings: [],
    });
    expect(report.server).toEqual({ name: 'legacy-fixture', version: '1.4.0' });
    expect(report.summary).toEqual({
      legacy: true,
      modern: false,
      connect: 'legacy-only',
      deprecatedTransport: false,
      session: null,
    });
    expect(report.hints.map((h) => h.id)).toEqual(['add-modern']);
  });

  it('modern server: works for 2026-07-28 only', async () => {
    const report = await probeStdio('modern');
    expect(matrix(report)).toEqual([
      '2026-07-28 stdio works',
      '2025-11-25 stdio fails',
      '2025-06-18 stdio fails',
      '2025-03-26 stdio fails',
      '2024-11-05 stdio fails',
    ]);
    expect(probe(report, '2026-07-28')).toMatchObject({
      negotiatedVersion: '2026-07-28',
      counts: { tools: 2, resources: null, prompts: 1 },
      serverInfo: { name: 'modern-fixture', version: '2.0.0' },
      warnings: [],
    });
    expect(probe(report, '2025-11-25').reason).toBe(
      'initialize returned error -32601: Method not found: initialize. This server supports protocol version 2026-07-28 only.',
    );
    expect(report.summary.connect).toBe('modern-only');
    expect(report.hints.map((h) => h.id)).toEqual(['keep-legacy']);
  });

  it('minimal modern server: warns about missing 2026-07-28 result fields', async () => {
    const report = await probeStdio('modern-minimal', { versions: ['2026-07-28', '2025-11-25'] });
    expect(matrix(report)).toEqual(['2026-07-28 stdio works', '2025-11-25 stdio fails']);
    expect(report.server).toBeNull();
    expect(report.warnings.map((w) => w.text)).toEqual([
      'server/discover result has no resultType',
      'server/discover result is missing ttlMs or cacheScope',
      'server/discover result has no io.modelcontextprotocol/serverInfo',
      'tools/list result has no resultType',
      'tools/list result is missing ttlMs or cacheScope',
    ]);
    expect(report.hints.map((h) => h.id)).toEqual([
      'keep-legacy',
      'initialize-error-versions',
      'cache-fields',
      'result-type',
      'server-info',
    ]);
  });

  it('dual-era server: both eras connect', async () => {
    const report = await probeStdio('dual');
    expect(matrix(report)).toEqual([
      '2026-07-28 stdio works',
      '2025-11-25 stdio works',
      '2025-06-18 stdio works',
      '2025-03-26 stdio works',
      '2024-11-05 stdio negotiated:2025-11-25',
    ]);
    expect(probe(report, '2026-07-28').capabilities).toEqual([
      'completions',
      'prompts',
      'resources',
      'tools',
    ]);
    expect(report.summary.connect).toBe('both');
    expect(report.hints).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('old server: negotiates down to 2024-11-05 and writes a banner to stdout', async () => {
    const report = await probeStdio('old');
    expect(matrix(report)).toEqual([
      '2026-07-28 stdio fails',
      '2025-11-25 stdio negotiated:2024-11-05',
      '2025-06-18 stdio negotiated:2024-11-05',
      '2025-03-26 stdio negotiated:2024-11-05',
      '2024-11-05 stdio works',
    ]);
    expect(report.warnings).toEqual([
      { id: 'stdout-noise', text: 'server wrote text that is not JSON-RPC to stdout' },
    ]);
    expect(report.hints.map((h) => h.id)).toEqual(['add-modern', 'update-legacy', 'stdout-noise']);
    expect(report.hints[1]?.text).toBe(
      'Accept protocol version 2025-11-25, the latest legacy version. Legacy-era clients currently negotiate down to 2024-11-05.',
    );
  });

  it('server that ignores server/discover: times out and suggests an error reply', async () => {
    const report = await probeStdio('silent-legacy', {
      versions: ['2026-07-28', '2025-11-25'],
      timeoutMs: 1500,
    });
    expect(probe(report, '2026-07-28')).toMatchObject({
      status: 'fails',
      failure: 'timeout',
      reason: 'no response to server/discover within 1500 ms',
    });
    expect(probe(report, '2025-11-25').status).toBe('works');
    expect(report.hints.map((h) => h.id)).toEqual(['add-modern', 'discover-timeout']);
  });

  it('hanging server: fails with a timeout but counts as reached', async () => {
    const report = await probeStdio('hang', { versions: ['2025-11-25'], timeoutMs: 500 });
    expect(probe(report, '2025-11-25')).toMatchObject({
      failure: 'timeout',
      reason: 'no response to initialize within 500 ms',
      reached: true,
    });
    expect(report.hints.map((h) => h.id)).toEqual(['nothing-works']);
  });

  it('server that exits at start: throws UnreachableError with the stderr line', async () => {
    const error = await probeStdio('crash').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreachableError);
    expect((error as Error).message).toBe(
      'could not start the server: server exited with code 1 before answering server/discover (stderr: fatal: missing API key)',
    );
  });

  it('server that crashes after initialize: fails on the list call', async () => {
    const report = await probeStdio('crash-after-init', { versions: ['2025-11-25'] });
    expect(probe(report, '2025-11-25')).toMatchObject({
      status: 'fails',
      failure: 'exited',
      negotiatedVersion: '2025-11-25',
      serverInfo: { name: 'crashy-fixture', version: '1.0.0' },
      reason:
        'server exited with code 2 before answering tools/list (stderr: crashed while handling tools/list)',
    });
  });

  it('server that sends malformed messages: fails with the problem', async () => {
    const report = await probeStdio('garbage', { versions: ['2026-07-28', '2025-11-25'] });
    expect(probe(report, '2026-07-28').reason).toBe(
      'invalid server/discover response: result has no supportedVersions list',
    );
    expect(probe(report, '2025-11-25').reason).toBe(
      'invalid initialize response: result is not an object',
    );
    expect(report.warnings.map((w) => w.id)).toEqual(['stdout-noise']);
  });
});
