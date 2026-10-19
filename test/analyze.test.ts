import { describe, expect, it } from 'vitest';
import { deriveHints, failOnMessage, matchFailOn, summarize } from '../src/analyze.js';
import { emptyProbe } from '../src/probe.js';
import type { ProtocolVersion } from '../src/protocol.js';
import type { ProbeResult, Report, TransportId } from '../src/types.js';

function make(
  version: ProtocolVersion,
  transport: TransportId,
  patch: Partial<ProbeResult>,
): ProbeResult {
  return { ...emptyProbe(version, transport), reached: true, ...patch };
}

function report(probes: ProbeResult[], versions: ProtocolVersion[]): Report {
  const summary = summarize(probes, versions);
  return {
    tool: { name: 'mcp-compat', version: '0.1.0' },
    target: { kind: 'stdio', command: 'x' },
    versions,
    transports: ['stdio'],
    server: null,
    probes,
    summary,
    hints: deriveHints(probes, versions, summary, []),
    warnings: [],
  };
}

describe('summarize', () => {
  it('reports null for eras that were not probed', () => {
    const probes = [
      make('2025-11-25', 'stdio', { status: 'works', negotiatedVersion: '2025-11-25' }),
    ];
    expect(summarize(probes, ['2025-11-25'])).toEqual({
      legacy: true,
      modern: null,
      connect: 'legacy-only',
      deprecatedTransport: false,
      session: null,
    });
  });

  it('does not count a legacy probe negotiated to an unknown version', () => {
    const probes = [
      make('2025-11-25', 'stdio', { status: 'negotiated', negotiatedVersion: '2099-01-01' }),
    ];
    expect(summarize(probes, ['2025-11-25']).legacy).toBe(false);
  });
});

describe('matchFailOn', () => {
  const probes = [
    make('2026-07-28', 'streamable-http', { status: 'fails', reason: 'x' }),
    make('2026-07-28', 'http-sse', { status: 'not-applicable' }),
    make('2025-11-25', 'streamable-http', {
      status: 'works',
      negotiatedVersion: '2025-11-25',
      session: 'required',
    }),
    make('2025-11-25', 'http-sse', { status: 'works', negotiatedVersion: '2025-11-25' }),
  ];
  const r = report(probes, ['2026-07-28', '2025-11-25']);

  it('matches each check', () => {
    expect(
      matchFailOn(r, [
        'no-modern',
        'no-legacy',
        'deprecated-transport',
        'session-required',
        'any-failure',
      ]),
    ).toEqual([
      { id: 'no-modern', detail: 'modern-era clients (2026-07-28) cannot connect' },
      {
        id: 'deprecated-transport',
        detail: 'the server still serves the deprecated HTTP+SSE transport',
      },
      { id: 'session-required', detail: 'Streamable HTTP requires Mcp-Session-Id' },
      { id: 'any-failure', detail: '1 of 3 probes failed' },
    ]);
  });

  it('formats the message', () => {
    expect(failOnMessage(matchFailOn(r, ['no-modern', 'session-required']))).toBe(
      'fail-on matched: no-modern (modern-era clients (2026-07-28) cannot connect), session-required (Streamable HTTP requires Mcp-Session-Id).',
    );
  });
});

describe('deriveHints', () => {
  it('suggests credentials for 401 and 403', () => {
    const probes = [make('2025-11-25', 'streamable-http', { status: 'fails', httpStatus: 403 })];
    expect(report(probes, ['2025-11-25']).hints.map((h) => h.id)).toEqual(['auth']);
  });

  it('says so when nothing works', () => {
    const probes = [make('2025-11-25', 'stdio', { status: 'fails', failure: 'timeout' })];
    expect(report(probes, ['2025-11-25']).hints.map((h) => h.id)).toEqual(['nothing-works']);
  });

  it('does not suggest adding 2026-07-28 when it was not probed', () => {
    const probes = [
      make('2025-11-25', 'stdio', { status: 'works', negotiatedVersion: '2025-11-25' }),
    ];
    expect(report(probes, ['2025-11-25']).hints).toEqual([]);
  });
});
