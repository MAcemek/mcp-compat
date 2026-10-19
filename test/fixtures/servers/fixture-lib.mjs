// Shared behavior of the fake MCP servers used by the tests, the demo and the Action self-test.
// Plain JavaScript so that `node` can run the fixtures directly.

export const MODERN = '2026-07-28';
export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/**
 * Server profiles. legacyVersions are the initialize versions the server accepts, newest
 * first; an unsupported request is answered with the first one. modern servers implement
 * server/discover and per-request _meta.
 */
export const PROFILES = {
  legacy: {
    name: 'legacy-fixture',
    version: '1.4.0',
    legacyVersions: ['2025-11-25', '2025-06-18'],
    modern: false,
    capabilities: { tools: {}, resources: {}, prompts: {} },
    counts: { tools: 3, resources: 1, prompts: 2 },
    pageSize: 2,
    discover: 'error',
    pingClient: true,
  },
  modern: {
    name: 'modern-fixture',
    version: '2.0.0',
    legacyVersions: [],
    modern: true,
    style: 'full',
    supportedVersions: [MODERN],
    capabilities: { tools: { listChanged: true }, prompts: {} },
    counts: { tools: 2, prompts: 1 },
    initializeError: {
      code: -32601,
      message:
        'Method not found: initialize. This server supports protocol version 2026-07-28 only.',
    },
  },
  'modern-minimal': {
    name: 'minimal-fixture',
    version: '0.3.0',
    legacyVersions: [],
    modern: true,
    style: 'minimal',
    supportedVersions: [MODERN],
    capabilities: { tools: {} },
    counts: { tools: 1 },
    initializeError: { code: -32601, message: 'Method not found' },
  },
  dual: {
    name: 'dual-fixture',
    version: '3.1.0',
    legacyVersions: ['2025-11-25', '2025-06-18', '2025-03-26'],
    modern: true,
    style: 'full',
    supportedVersions: [MODERN, '2025-11-25', '2025-06-18', '2025-03-26'],
    capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
    counts: { tools: 4, resources: 2, prompts: 1 },
    discover: 'error',
  },
  old: {
    name: 'old-fixture',
    version: '0.9.1',
    legacyVersions: ['2024-11-05'],
    modern: false,
    capabilities: { tools: {} },
    counts: { tools: 1 },
    discover: 'error',
    banner: 'old-fixture ready',
  },
  'silent-legacy': {
    name: 'silent-fixture',
    version: '1.0.0',
    legacyVersions: ['2025-11-25'],
    modern: false,
    capabilities: { tools: {} },
    counts: { tools: 1 },
    discover: 'silent',
  },
  'crash-after-init': {
    name: 'crashy-fixture',
    version: '1.0.0',
    legacyVersions: ['2025-11-25'],
    modern: false,
    capabilities: { tools: {} },
    counts: { tools: 1 },
    discover: 'error',
    crashAfterInit: true,
  },
  session: {
    name: 'session-fixture',
    version: '5.2.0',
    legacyVersions: ['2025-11-25', '2025-06-18', '2025-03-26'],
    modern: false,
    capabilities: { tools: {}, prompts: {} },
    counts: { tools: 2, prompts: 1 },
    discover: 'error',
  },
  sse: {
    name: 'sse-fixture',
    version: '0.4.2',
    legacyVersions: ['2024-11-05'],
    modern: false,
    capabilities: { tools: {}, resources: {} },
    counts: { tools: 1, resources: 1 },
    discover: 'error',
  },
};

export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id, code, message, data) {
  const error = data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: '2.0', id, error };
}

/** True when the request carries the 2026-07-28 per-request _meta. */
export function isModernRequest(message) {
  return (
    isObject(message.params) &&
    isObject(message.params._meta) &&
    META_PROTOCOL_VERSION in message.params._meta
  );
}

function makeItem(kind, index) {
  if (kind === 'tools') {
    return {
      name: `tool_${index}`,
      description: `Fixture tool ${index}.`,
      inputSchema: { type: 'object' },
    };
  }
  if (kind === 'resources')
    return { uri: `fixture://resource/${index}`, name: `resource_${index}` };
  return { name: `prompt_${index}`, description: `Fixture prompt ${index}.` };
}

const LIST_KINDS = {
  'tools/list': 'tools',
  'resources/list': 'resources',
  'prompts/list': 'prompts',
};

function modernFields(profile) {
  if (profile.style === 'minimal') return {};
  return {
    resultType: 'complete',
    ttlMs: 60000,
    cacheScope: 'public',
    _meta: { [META_SERVER_INFO]: { name: profile.name, version: profile.version } },
  };
}

function listResult(profile, message, modern) {
  const kind = LIST_KINDS[message.method];
  if (!(kind in profile.capabilities)) return rpcError(message.id, -32601, 'Method not found');
  const total = profile.counts[kind] ?? 0;
  const pageSize = profile.pageSize ?? total;
  const cursor = isObject(message.params) ? message.params.cursor : undefined;
  const start = typeof cursor === 'string' ? Number(cursor) : 0;
  const items = [];
  for (let i = start; i < Math.min(start + pageSize, total); i++) items.push(makeItem(kind, i + 1));
  const result = { [kind]: items };
  if (start + pageSize < total) result.nextCursor = String(start + pageSize);
  return rpcResult(message.id, modern ? { ...result, ...modernFields(profile) } : result);
}

/** Handles a request without _meta. Returns the reply, or null for no reply. */
export function handleLegacy(profile, message) {
  const id = message.id;
  if (message.method === 'initialize') {
    if (profile.legacyVersions.length === 0) {
      const error = profile.initializeError;
      return rpcError(id, error.code, error.message, error.data);
    }
    const requested = isObject(message.params) ? message.params.protocolVersion : undefined;
    const version = profile.legacyVersions.includes(requested)
      ? requested
      : profile.legacyVersions[0];
    return rpcResult(id, {
      protocolVersion: version,
      capabilities: profile.capabilities,
      serverInfo: { name: profile.name, version: profile.version },
    });
  }
  if (profile.legacyVersions.length === 0) {
    return rpcError(id, -32602, 'Invalid params: _meta with a protocol version is required');
  }
  if (message.method === 'ping') return rpcResult(id, {});
  if (message.method in LIST_KINDS) return listResult(profile, message, false);
  if (message.method === 'server/discover' && profile.discover === 'silent') return null;
  return rpcError(id, -32601, 'Method not found');
}

/** Handles a request that carries 2026-07-28 _meta. */
export function handleModern(profile, message) {
  const id = message.id;
  const meta = message.params._meta;
  const version = meta[META_PROTOCOL_VERSION];
  if (typeof version !== 'string' || !isObject(meta[META_CLIENT_CAPABILITIES])) {
    return rpcError(
      id,
      -32602,
      'Invalid params: _meta needs protocolVersion and clientCapabilities',
    );
  }
  if (version !== MODERN) {
    return rpcError(id, -32022, 'Unsupported protocol version', {
      supported: [MODERN],
      requested: version,
    });
  }
  if (message.method === 'server/discover') {
    return rpcResult(id, {
      supportedVersions: profile.supportedVersions,
      capabilities: profile.capabilities,
      ...modernFields(profile),
    });
  }
  if (message.method in LIST_KINDS) return listResult(profile, message, true);
  return rpcError(id, -32601, 'Method not found');
}

/** Routes a request by era. Legacy-only servers ignore _meta. */
export function handleRequest(profile, message) {
  if (profile.modern && isModernRequest(message)) return handleModern(profile, message);
  return handleLegacy(profile, message);
}

/** HTTP status for a modern error reply, as Streamable HTTP 2026-07-28 requires. */
export function modernStatus(reply) {
  if (!reply || !reply.error) return 200;
  if (reply.error.code === -32601) return 404;
  if ([-32602, -32020, -32021, -32022].includes(reply.error.code)) return 400;
  return 200;
}
