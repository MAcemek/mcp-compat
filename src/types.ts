import type { Era, ListKind, ProtocolVersion } from './protocol.js';

export type TransportId = 'stdio' | 'streamable-http' | 'http-sse';

export const TRANSPORT_LABELS: Record<TransportId, string> = {
  stdio: 'stdio',
  'streamable-http': 'Streamable HTTP',
  'http-sse': 'HTTP+SSE',
};

/**
 * works: the server accepted the requested version and every advertised list call succeeded.
 * negotiated: the server answered initialize with a different version (see negotiatedVersion).
 * fails: the probe did not complete (see reason).
 * not-applicable: the version does not define this transport.
 */
export type ProbeStatus = 'works' | 'negotiated' | 'fails' | 'not-applicable';

export type FailureKind = 'timeout' | 'exited' | 'network' | 'http' | 'rpc-error' | 'invalid';

/** none: no Mcp-Session-Id issued. optional: issued but not required. required: requests without it are rejected. */
export type SessionMode = 'none' | 'optional' | 'required';

export type WarningId =
  | 'stdout-noise'
  | 'invalid-message'
  | 'missing-result-type'
  | 'missing-cache-fields'
  | 'missing-server-info'
  | 'session-on-modern'
  | 'pagination-limit';

export interface ProbeWarning {
  id: WarningId;
  text: string;
}

export interface ServerInfo {
  name: string;
  version: string;
}

/** Number of items returned by each list method. null when the capability is not advertised. */
export type ListCounts = Record<ListKind, number | null>;

export interface ProbeResult {
  version: ProtocolVersion;
  era: Era;
  transport: TransportId;
  status: ProbeStatus;
  /** The version the server answered with (legacy) or that was used (modern). */
  negotiatedVersion: string | null;
  /** Empty unless status is fails or not-applicable. */
  reason: string;
  failure: FailureKind | null;
  errorCode: number | null;
  httpStatus: number | null;
  /** Whether the server produced any output or HTTP response during this probe. */
  reached: boolean;
  serverInfo: ServerInfo | null;
  /** Top-level server capability names, sorted. */
  capabilities: string[];
  counts: ListCounts;
  /** Streamable HTTP legacy probes only. */
  session: SessionMode | null;
  warnings: ProbeWarning[];
}

export type ConnectSummary = 'both' | 'legacy-only' | 'modern-only' | 'neither';

export interface Summary {
  /** Legacy-era clients can connect. null when no legacy version was probed. */
  legacy: boolean | null;
  /** Modern-era clients can connect. null when 2026-07-28 was not probed. */
  modern: boolean | null;
  connect: ConnectSummary;
  /** The server still serves the deprecated HTTP+SSE transport. */
  deprecatedTransport: boolean;
  session: SessionMode | null;
}

export type HintId =
  | 'auth'
  | 'add-modern'
  | 'keep-legacy'
  | 'initialize-error-versions'
  | 'discover-timeout'
  | 'update-legacy'
  | 'session-required'
  | 'sse-only'
  | 'sse-deprecated'
  | 'cache-fields'
  | 'result-type'
  | 'server-info'
  | 'stdout-noise'
  | 'session-on-modern'
  | 'nothing-works';

export interface Hint {
  id: HintId;
  text: string;
}

export type ReportTarget =
  { kind: 'stdio'; command: string } | { kind: 'url'; url: string; headers: string[] };

export interface Report {
  tool: { name: 'mcp-compat'; version: string };
  target: ReportTarget;
  versions: ProtocolVersion[];
  transports: TransportId[];
  server: ServerInfo | null;
  probes: ProbeResult[];
  summary: Summary;
  hints: Hint[];
  warnings: ProbeWarning[];
}

export const FAIL_ON_IDS = [
  'no-modern',
  'no-legacy',
  'deprecated-transport',
  'session-required',
  'any-failure',
] as const;

export type FailOnId = (typeof FAIL_ON_IDS)[number];

export type OutputFormat = 'text' | 'markdown' | 'json';

export interface HeaderPair {
  name: string;
  value: string;
}

/** What to probe. The URL and header values never appear in a Report. */
export type Target =
  { kind: 'stdio'; command: string } | { kind: 'url'; url: URL; headers: HeaderPair[] };
