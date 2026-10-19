import { WarningList, type Channel } from './channel.js';
import { failure, outcomeFailure, type RpcFailure } from './jsonrpc.js';
import {
  eraOf,
  initializeParams,
  LIST_KINDS,
  LIST_METHODS,
  META_SERVER_INFO,
  modernMeta,
  type Era,
  type ListKind,
  type ProtocolVersion,
} from './protocol.js';
import { cleanText, isRecord } from './sanitize.js';
import { TRANSPORT_LABELS, type ProbeResult, type ServerInfo, type TransportId } from './types.js';

/** Most pages read from one list method. */
export const MAX_PAGES = 50;

export function emptyProbe(version: ProtocolVersion, transport: TransportId): ProbeResult {
  return {
    version,
    era: eraOf(version),
    transport,
    status: 'fails',
    negotiatedVersion: null,
    reason: '',
    failure: null,
    errorCode: null,
    httpStatus: null,
    reached: false,
    serverInfo: null,
    capabilities: [],
    counts: { tools: null, resources: null, prompts: null },
    session: null,
    warnings: [],
  };
}

/** The probe result for a version that does not define the transport. */
export function notApplicableProbe(version: ProtocolVersion, transport: TransportId): ProbeResult {
  return {
    ...emptyProbe(version, transport),
    status: 'not-applicable',
    reason: `${version} does not define ${TRANSPORT_LABELS[transport]}`,
  };
}

export function readImplementation(value: unknown): ServerInfo | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  const version = typeof value.version === 'string' ? value.version : '';
  return { name: cleanText(value.name, 100), version: cleanText(version, 100) };
}

function fail(probe: ProbeResult, outcome: RpcFailure): ProbeResult {
  return {
    ...probe,
    status: 'fails',
    reason: outcome.reason,
    failure: outcome.failure,
    errorCode: outcome.errorCode,
    httpStatus: outcome.httpStatus,
  };
}

function invalid(method: string, detail: string): RpcFailure {
  return failure('invalid', `invalid ${method} response: ${detail}`);
}

/**
 * Checks the fields 2026-07-28 requires on results. Returns a failure for an unusable
 * resultType and records warnings for missing fields.
 */
function checkModernResult(
  result: Record<string, unknown>,
  method: string,
  cacheable: boolean,
  warnings: WarningList,
): RpcFailure | null {
  const resultType = result.resultType;
  if (resultType === undefined) {
    warnings.add({ id: 'missing-result-type', text: `${method} result has no resultType` });
  } else if (resultType !== 'complete') {
    return invalid(method, `resultType is ${cleanText(JSON.stringify(resultType), 40)}`);
  }
  if (cacheable) {
    const ttl = result.ttlMs;
    const scope = result.cacheScope;
    const ttlOk = typeof ttl === 'number' && Number.isFinite(ttl) && ttl >= 0;
    if (!ttlOk || (scope !== 'public' && scope !== 'private')) {
      warnings.add({
        id: 'missing-cache-fields',
        text: `${method} result is missing ttlMs or cacheScope`,
      });
    }
  }
  return null;
}

async function listAll(
  channel: Channel,
  kind: ListKind,
  era: Era,
  version: ProtocolVersion,
  warnings: WarningList,
): Promise<number | RpcFailure> {
  const method = LIST_METHODS[kind];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let count = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, unknown> = era === 'modern' ? { _meta: modernMeta(version) } : {};
    if (cursor !== undefined) params.cursor = cursor;
    const outcome = await channel.request(method, params);
    if (outcome.kind !== 'result') return outcomeFailure(method, outcome);
    if (era === 'modern') {
      const problem = checkModernResult(outcome.result, method, true, warnings);
      if (problem) return problem;
    }
    const items = outcome.result[kind];
    if (!Array.isArray(items)) return invalid(method, `result has no ${kind} array`);
    count += items.length;
    const next = outcome.result.nextCursor;
    if (typeof next !== 'string' || next === '' || seen.has(next)) return count;
    seen.add(next);
    cursor = next;
  }
  warnings.add({
    id: 'pagination-limit',
    text: `stopped reading ${method} after ${MAX_PAGES} pages`,
  });
  return count;
}

function capabilityNames(capabilities: unknown): string[] {
  return isRecord(capabilities) ? Object.keys(capabilities).sort() : [];
}

async function readLists(
  channel: Channel,
  probe: ProbeResult,
  capabilities: unknown,
  version: ProtocolVersion,
  warnings: WarningList,
): Promise<ProbeResult> {
  const names = capabilityNames(capabilities);
  let result = { ...probe, capabilities: names, counts: { ...probe.counts } };
  for (const kind of LIST_KINDS) {
    if (!names.includes(kind)) continue;
    const count = await listAll(channel, kind, probe.era, version, warnings);
    if (typeof count !== 'number') return fail(result, count);
    result = { ...result, counts: { ...result.counts, [kind]: count } };
  }
  return result;
}

/** initialize asking for exactly `version`, notifications/initialized, then the advertised lists. */
async function probeLegacy(
  channel: Channel,
  version: ProtocolVersion,
  warnings: WarningList,
): Promise<ProbeResult> {
  const probe = emptyProbe(version, channel.transport);
  const init = await channel.request('initialize', initializeParams(version));
  if (init.kind !== 'result') return fail(probe, outcomeFailure('initialize', init));
  const answered = init.result.protocolVersion;
  if (typeof answered !== 'string' || answered === '') {
    return fail(probe, invalid('initialize', 'result has no protocolVersion'));
  }
  const negotiated = cleanText(answered, 40);
  channel.setProtocolVersion(answered);
  const started: ProbeResult = {
    ...probe,
    status: answered === version ? 'works' : 'negotiated',
    negotiatedVersion: negotiated,
    serverInfo: readImplementation(init.result.serverInfo),
    capabilities: capabilityNames(init.result.capabilities),
  };
  const notified = await channel.notify('notifications/initialized');
  if (notified) return fail(started, notified);
  const listed = await readLists(channel, started, init.result.capabilities, version, warnings);
  if (listed.status === 'fails' || channel.transport !== 'streamable-http') return listed;
  return { ...listed, session: await channel.checkSession() };
}

/** server/discover with per-request _meta, then the advertised lists. */
async function probeModern(
  channel: Channel,
  version: ProtocolVersion,
  warnings: WarningList,
): Promise<ProbeResult> {
  const probe = emptyProbe(version, channel.transport);
  channel.setProtocolVersion(version);
  const discover = await channel.request('server/discover', { _meta: modernMeta(version) });
  if (discover.kind !== 'result') return fail(probe, outcomeFailure('server/discover', discover));
  const result = discover.result;
  const supported = result.supportedVersions;
  if (!Array.isArray(supported) || !supported.every((v) => typeof v === 'string')) {
    return fail(probe, invalid('server/discover', 'result has no supportedVersions list'));
  }
  if (!isRecord(result.capabilities)) {
    return fail(probe, invalid('server/discover', 'result has no capabilities object'));
  }
  if (!supported.includes(version)) {
    return fail(probe, invalid('server/discover', `supportedVersions does not list ${version}`));
  }
  const problem = checkModernResult(result, 'server/discover', true, warnings);
  if (problem) return fail(probe, problem);
  const meta = isRecord(result._meta) ? result._meta : {};
  const serverInfo = readImplementation(meta[META_SERVER_INFO]);
  if (serverInfo === null) {
    warnings.add({
      id: 'missing-server-info',
      text: `server/discover result has no ${META_SERVER_INFO}`,
    });
  }
  const started: ProbeResult = {
    ...probe,
    status: 'works',
    negotiatedVersion: version,
    serverInfo,
    capabilities: capabilityNames(result.capabilities),
  };
  return readLists(channel, started, result.capabilities, version, warnings);
}

/** Runs one probe on a fresh channel. The caller closes the channel. */
export async function runProbe(channel: Channel, version: ProtocolVersion): Promise<ProbeResult> {
  const warnings = new WarningList();
  const opened = await channel.open();
  let result: ProbeResult;
  if (opened) {
    result = fail(emptyProbe(version, channel.transport), opened);
  } else if (eraOf(version) === 'modern') {
    result = await probeModern(channel, version, warnings);
  } else {
    result = await probeLegacy(channel, version, warnings);
  }
  for (const warning of channel.warnings()) warnings.add(warning);
  return { ...result, reached: channel.reached(), warnings: warnings.list() };
}
