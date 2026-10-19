import { LEGACY_VERSIONS, MODERN_VERSIONS, type ProtocolVersion } from './protocol.js';
import type {
  ConnectSummary,
  FailOnId,
  Hint,
  ProbeResult,
  ProbeWarning,
  Report,
  ServerInfo,
  Summary,
} from './types.js';

function isLegacyVersion(value: string | null): boolean {
  return value !== null && (LEGACY_VERSIONS as readonly string[]).includes(value);
}

/** A legacy probe counts as connectable when it works or negotiated another legacy version. */
export function legacyConnects(probe: ProbeResult): boolean {
  if (probe.era !== 'legacy') return false;
  return (
    probe.status === 'works' ||
    (probe.status === 'negotiated' && isLegacyVersion(probe.negotiatedVersion))
  );
}

export function modernConnects(probe: ProbeResult): boolean {
  return probe.era === 'modern' && probe.status === 'works';
}

function connectSummary(legacy: boolean | null, modern: boolean | null): ConnectSummary {
  if (legacy === true && modern === true) return 'both';
  if (legacy === true) return 'legacy-only';
  if (modern === true) return 'modern-only';
  return 'neither';
}

export function summarize(probes: ProbeResult[], versions: ProtocolVersion[]): Summary {
  const probedLegacy = versions.some((v) => LEGACY_VERSIONS.includes(v));
  const probedModern = versions.some((v) => MODERN_VERSIONS.includes(v));
  const legacy = probedLegacy ? probes.some(legacyConnects) : null;
  const modern = probedModern ? probes.some(modernConnects) : null;
  const session =
    probes.find((p) => p.transport === 'streamable-http' && p.session !== null)?.session ?? null;
  return {
    legacy,
    modern,
    connect: connectSummary(legacy, modern),
    deprecatedTransport: probes.some(
      (p) => p.transport === 'http-sse' && (p.status === 'works' || p.status === 'negotiated'),
    ),
    session,
  };
}

/** The serverInfo of the newest probe that has one. */
export function pickServer(probes: ProbeResult[]): ServerInfo | null {
  return probes.find((p) => p.serverInfo !== null)?.serverInfo ?? null;
}

/** All probe warnings, first occurrence of each text only. */
export function collectWarnings(probes: ProbeResult[]): ProbeWarning[] {
  const warnings: ProbeWarning[] = [];
  for (const probe of probes) {
    for (const warning of probe.warnings) {
      if (!warnings.some((w) => w.text === warning.text)) warnings.push(warning);
    }
  }
  return warnings;
}

const HINT_TEXT = {
  auth: 'The server answered HTTP 401 or 403. Pass credentials with --header, for example --header "Authorization: Bearer $TOKEN".',
  'add-modern':
    "Add 2026-07-28 support: implement server/discover and read the protocol version and client capabilities from each request's _meta. Modern-era clients that do not fall back to initialize cannot connect.",
  'keep-legacy':
    'Keep answering initialize if legacy-era clients should connect. They cannot fall forward to 2026-07-28.',
  'initialize-error-versions':
    'Name the supported version (2026-07-28) in the error returned to initialize. It is the only message a legacy-era client can show its user.',
  'discover-timeout':
    'The server did not answer server/discover. Reply to unknown methods with a JSON-RPC error so that dual-era clients can fall back to initialize without waiting for a timeout.',
  'session-required':
    'Streamable HTTP requires Mcp-Session-Id. 2026-07-28 removes sessions; serve each request on its own so that the server works behind load balancers without sticky sessions.',
  'sse-only':
    'The server only speaks the deprecated HTTP+SSE transport. Add Streamable HTTP; 2026-07-28 does not use HTTP+SSE.',
  'sse-deprecated':
    'HTTP+SSE is deprecated. Keep it only as long as older clients need it, next to Streamable HTTP.',
  'cache-fields':
    'Add ttlMs and cacheScope to server/discover and list results. 2026-07-28 requires them.',
  'result-type': 'Add resultType: "complete" to every 2026-07-28 result.',
  'server-info':
    'Include io.modelcontextprotocol/serverInfo in the _meta of 2026-07-28 results so that clients can identify the server.',
  'stdout-noise':
    'Write logs to stderr. Text on stdout that is not a JSON-RPC message can break clients.',
  'session-on-modern':
    'Do not send Mcp-Session-Id on 2026-07-28 responses. The revision has no sessions.',
  'nothing-works': 'No probe succeeded. Check the reason listed for each version.',
} as const;

function newestConnectingLegacy(probes: ProbeResult[]): string | null {
  for (const version of LEGACY_VERSIONS) {
    const probe = probes.find((p) => p.version === version && legacyConnects(p));
    if (probe) return probe.negotiatedVersion;
  }
  return null;
}

/** Concrete migration hints, in a fixed order. */
export function deriveHints(
  probes: ProbeResult[],
  versions: ProtocolVersion[],
  summary: Summary,
  warnings: ProbeWarning[],
): Hint[] {
  const hints: Hint[] = [];
  const add = (id: Exclude<Hint['id'], 'update-legacy'>): void => {
    hints.push({ id, text: HINT_TEXT[id] });
  };
  const hasWarning = (id: ProbeWarning['id']): boolean => warnings.some((w) => w.id === id);
  const auth = probes.some((p) => p.httpStatus === 401 || p.httpStatus === 403);
  const modernProbes = probes.filter((p) => p.era === 'modern' && p.status !== 'not-applicable');
  const legacyProbes = probes.filter((p) => p.era === 'legacy');

  if (auth) add('auth');
  if (summary.legacy === true && summary.modern === false) add('add-modern');
  if (summary.modern === true && summary.legacy === false) {
    add('keep-legacy');
    const initErrors = legacyProbes.filter(
      (p) =>
        (p.failure === 'rpc-error' || p.failure === 'http') && p.reason.startsWith('initialize'),
    );
    if (initErrors.length > 0 && initErrors.every((p) => !p.reason.includes('2026-07-28'))) {
      add('initialize-error-versions');
    }
  }
  if (
    summary.modern === false &&
    modernProbes.some((p) => p.transport === 'stdio' && p.failure === 'timeout' && p.reached)
  ) {
    add('discover-timeout');
  }
  if (summary.legacy === true && versions.includes('2025-11-25')) {
    const latest = probes.some((p) => p.version === '2025-11-25' && p.status === 'works');
    const newest = newestConnectingLegacy(probes);
    if (!latest && newest !== null) {
      hints.push({
        id: 'update-legacy',
        text: `Accept protocol version 2025-11-25, the latest legacy version. Legacy-era clients currently negotiate down to ${newest}.`,
      });
    }
  }
  if (summary.session === 'required') add('session-required');
  if (summary.deprecatedTransport) {
    const streamable = probes.some(
      (p) =>
        p.transport === 'streamable-http' && (p.status === 'works' || p.status === 'negotiated'),
    );
    add(streamable ? 'sse-deprecated' : 'sse-only');
  }
  if (summary.modern === true) {
    if (hasWarning('missing-cache-fields')) add('cache-fields');
    if (hasWarning('missing-result-type')) add('result-type');
    if (hasWarning('missing-server-info')) add('server-info');
    if (hasWarning('session-on-modern')) add('session-on-modern');
  }
  if (hasWarning('stdout-noise')) add('stdout-noise');
  if (summary.connect === 'neither' && !auth) add('nothing-works');
  return hints;
}

export interface FailOnMatch {
  id: FailOnId;
  detail: string;
}

export function matchFailOn(report: Report, failOn: FailOnId[]): FailOnMatch[] {
  const matches: FailOnMatch[] = [];
  const failed = report.probes.filter((p) => p.status === 'fails').length;
  const total = report.probes.filter((p) => p.status !== 'not-applicable').length;
  for (const id of failOn) {
    if (id === 'no-modern' && report.summary.modern !== true) {
      matches.push({ id, detail: 'modern-era clients (2026-07-28) cannot connect' });
    }
    if (id === 'no-legacy' && report.summary.legacy !== true) {
      matches.push({ id, detail: 'legacy-era clients cannot connect' });
    }
    if (id === 'deprecated-transport' && report.summary.deprecatedTransport) {
      matches.push({ id, detail: 'the server still serves the deprecated HTTP+SSE transport' });
    }
    if (id === 'session-required' && report.summary.session === 'required') {
      matches.push({ id, detail: 'Streamable HTTP requires Mcp-Session-Id' });
    }
    if (id === 'any-failure' && failed > 0) {
      matches.push({ id, detail: `${failed} of ${total} probes failed` });
    }
  }
  return matches;
}

export function failOnMessage(matches: FailOnMatch[]): string {
  return `fail-on matched: ${matches.map((m) => `${m.id} (${m.detail})`).join(', ')}.`;
}
