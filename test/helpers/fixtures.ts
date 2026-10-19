import type { ProtocolVersion } from '../../src/protocol.js';
import { runProbes } from '../../src/run.js';
import type { ProbeResult, Report } from '../../src/types.js';

/** The shell command that starts a stdio fixture profile. */
export function fixtureCommand(profile: string, ...extra: string[]): string {
  return ['node', 'test/fixtures/servers/stdio-server.mjs', profile, ...extra].join(' ');
}

/** Runs every probe against a stdio fixture profile. */
export function probeStdio(
  profile: string,
  options: { versions?: ProtocolVersion[]; timeoutMs?: number; extra?: string[] } = {},
): Promise<Report> {
  return runProbes(
    {
      target: { kind: 'stdio', command: fixtureCommand(profile, ...(options.extra ?? [])) },
      versions: options.versions ?? [
        '2026-07-28',
        '2025-11-25',
        '2025-06-18',
        '2025-03-26',
        '2024-11-05',
      ],
      timeoutMs: options.timeoutMs ?? 10_000,
    },
    { fetch: (input, init) => fetch(input, init), cwd: process.cwd() },
  );
}

/** Runs every probe against an HTTP URL. */
export function probeUrl(
  url: string,
  options: {
    versions?: ProtocolVersion[];
    timeoutMs?: number;
    headers?: { name: string; value: string }[];
  } = {},
): Promise<Report> {
  return runProbes(
    {
      target: { kind: 'url', url: new URL(url), headers: options.headers ?? [] },
      versions: options.versions ?? [
        '2026-07-28',
        '2025-11-25',
        '2025-06-18',
        '2025-03-26',
        '2024-11-05',
      ],
      timeoutMs: options.timeoutMs ?? 10_000,
    },
    { fetch: (input, init) => fetch(input, init), cwd: process.cwd() },
  );
}

/** "version transport status" for each probe, for compact assertions. */
export function matrix(report: Report): string[] {
  return report.probes.map((p) => `${p.version} ${p.transport} ${cell(p)}`);
}

function cell(probe: ProbeResult): string {
  return probe.status === 'negotiated' ? `negotiated:${probe.negotiatedVersion}` : probe.status;
}

export function probe(report: Report, version: ProtocolVersion, transport?: string): ProbeResult {
  const found = report.probes.find(
    (p) => p.version === version && (transport === undefined || p.transport === transport),
  );
  if (!found) throw new Error(`no probe for ${version} ${transport ?? ''}`);
  return found;
}

export class Capture {
  text = '';
  isTTY?: boolean;
  constructor(isTTY?: boolean) {
    this.isTTY = isTTY;
  }
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}
