import { CLIENT_INFO } from './version.js';

/**
 * Dated protocol revisions, newest first. Taken from the schema/ directory of
 * github.com/modelcontextprotocol/modelcontextprotocol.
 */
export const KNOWN_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export type ProtocolVersion = (typeof KNOWN_VERSIONS)[number];

/** Revisions that use the initialize handshake (2025-11-25 and earlier). */
export const LEGACY_VERSIONS: readonly ProtocolVersion[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

/** Revisions that carry the version and capabilities in each request's _meta. */
export const MODERN_VERSIONS: readonly ProtocolVersion[] = ['2026-07-28'];

export type Era = 'legacy' | 'modern';

export function eraOf(version: ProtocolVersion): Era {
  return MODERN_VERSIONS.includes(version) ? 'modern' : 'legacy';
}

export function isKnownVersion(value: string): value is ProtocolVersion {
  return (KNOWN_VERSIONS as readonly string[]).includes(value);
}

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** Requests mcp-compat may send. Anything else is refused by encodeRequest. */
export const REQUEST_METHODS = [
  'initialize',
  'ping',
  'server/discover',
  'tools/list',
  'resources/list',
  'prompts/list',
] as const;

export type RequestMethod = (typeof REQUEST_METHODS)[number];

/** Notifications mcp-compat may send. */
export const NOTIFICATION_METHODS = ['notifications/initialized'] as const;

export type NotificationMethod = (typeof NOTIFICATION_METHODS)[number];

export const LIST_KINDS = ['tools', 'resources', 'prompts'] as const;

export type ListKind = (typeof LIST_KINDS)[number];

export const LIST_METHODS: Record<ListKind, RequestMethod> = {
  tools: 'tools/list',
  resources: 'resources/list',
  prompts: 'prompts/list',
};

/** Params for an initialize request that asks for exactly `version`. */
export function initializeParams(version: string): Record<string, unknown> {
  return { protocolVersion: version, capabilities: {}, clientInfo: { ...CLIENT_INFO } };
}

/** The per-request _meta object required by 2026-07-28. */
export function modernMeta(version: string): Record<string, unknown> {
  return {
    [META_PROTOCOL_VERSION]: version,
    [META_CLIENT_INFO]: { ...CLIENT_INFO },
    [META_CLIENT_CAPABILITIES]: {},
  };
}
