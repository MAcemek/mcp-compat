import { collectWarnings, deriveHints, pickServer, summarize } from './analyze.js';
import type { Channel } from './channel.js';
import { UnreachableError } from './errors.js';
import { notApplicableProbe, runProbe } from './probe.js';
import { eraOf, KNOWN_VERSIONS, type ProtocolVersion } from './protocol.js';
import { displayUrl } from './sanitize.js';
import type { FetchFn } from './transports/http-common.js';
import { LegacySseChannel } from './transports/legacy-sse.js';
import { StdioChannel } from './transports/stdio.js';
import { StreamableHttpChannel } from './transports/streamable-http.js';
import type { ProbeResult, Report, ReportTarget, Target, TransportId } from './types.js';
import { VERSION } from './version.js';

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunRequest {
  target: Target;
  versions: ProtocolVersion[];
  timeoutMs: number;
}

export interface RunDeps {
  fetch: FetchFn;
  /** Working directory for --stdio commands. */
  cwd: string;
  platform?: NodeJS.Platform;
}

export function transportsFor(target: Target): TransportId[] {
  return target.kind === 'stdio' ? ['stdio'] : ['streamable-http', 'http-sse'];
}

function reportTarget(target: Target): ReportTarget {
  if (target.kind === 'stdio') return { kind: 'stdio', command: target.command };
  return { kind: 'url', url: displayUrl(target.url), headers: target.headers.map((h) => h.name) };
}

function createChannel(
  target: Target,
  transport: TransportId,
  version: ProtocolVersion,
  timeoutMs: number,
  deps: RunDeps,
): Channel {
  if (target.kind === 'stdio') {
    return new StdioChannel({
      command: target.command,
      cwd: deps.cwd,
      timeoutMs,
      platform: deps.platform,
    });
  }
  const options = { url: target.url, headers: target.headers, timeoutMs, fetch: deps.fetch };
  return transport === 'http-sse'
    ? new LegacySseChannel(options)
    : new StreamableHttpChannel(options, eraOf(version));
}

/** Sorts versions newest first and removes duplicates. */
export function orderVersions(versions: ProtocolVersion[]): ProtocolVersion[] {
  return KNOWN_VERSIONS.filter((v) => versions.includes(v));
}

/**
 * Probes every version on every transport of the target, one fresh process or HTTP exchange
 * per probe, one probe at a time. Throws UnreachableError when no probe reached the server.
 */
export async function runProbes(request: RunRequest, deps: RunDeps): Promise<Report> {
  const versions = orderVersions(request.versions);
  const transports = transportsFor(request.target);
  const probes: ProbeResult[] = [];
  for (const version of versions) {
    for (const transport of transports) {
      if (transport === 'http-sse' && eraOf(version) === 'modern') {
        probes.push(notApplicableProbe(version, transport));
        continue;
      }
      const channel = createChannel(request.target, transport, version, request.timeoutMs, deps);
      try {
        probes.push(await runProbe(channel, version));
      } finally {
        await channel.close();
      }
    }
  }
  const attempted = probes.filter((p) => p.status !== 'not-applicable');
  if (attempted.length > 0 && attempted.every((p) => !p.reached)) {
    const first = attempted[0]?.reason ?? '';
    throw new UnreachableError(
      request.target.kind === 'stdio'
        ? `could not start the server: ${first}`
        : `could not reach ${displayUrl(request.target.url)}: ${first}`,
    );
  }
  const summary = summarize(probes, versions);
  const warnings = collectWarnings(probes);
  return {
    tool: { name: 'mcp-compat', version: VERSION },
    target: reportTarget(request.target),
    versions,
    transports,
    server: pickServer(probes),
    probes,
    summary,
    hints: deriveHints(probes, versions, summary, warnings),
    warnings,
  };
}
