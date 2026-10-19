import {
  METHOD_NOT_FOUND,
  NOTIFICATION_METHODS,
  REQUEST_METHODS,
  type NotificationMethod,
  type RequestMethod,
} from './protocol.js';
import { cleanText, isRecord } from './sanitize.js';
import type { FailureKind } from './types.js';

export type JsonRpcId = string | number;

/** A message received from the server, classified. */
export type Incoming =
  | { kind: 'response'; id: JsonRpcId; result: Record<string, unknown> }
  | { kind: 'error'; id: JsonRpcId | null; code: number; message: string; data: unknown }
  | { kind: 'request'; id: JsonRpcId; method: string }
  | { kind: 'notification'; method: string }
  | { kind: 'invalid'; detail: string; id: JsonRpcId | null };

export interface RpcFailure {
  kind: 'failure';
  failure: FailureKind;
  reason: string;
  httpStatus: number | null;
  errorCode: number | null;
}

export type RpcOutcome =
  | { kind: 'result'; result: Record<string, unknown>; httpStatus: number | null }
  | {
      kind: 'error';
      code: number;
      message: string;
      data: unknown;
      httpStatus: number | null;
    }
  | RpcFailure;

export function failure(
  kind: FailureKind,
  reason: string,
  extra: { httpStatus?: number | null; errorCode?: number | null } = {},
): RpcFailure {
  return {
    kind: 'failure',
    failure: kind,
    reason,
    httpStatus: extra.httpStatus ?? null,
    errorCode: extra.errorCode ?? null,
  };
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Classifies one decoded JSON value as a JSON-RPC message. */
export function classifyMessage(value: unknown): Incoming {
  if (!isRecord(value))
    return { kind: 'invalid', detail: 'message is not a JSON object', id: null };
  const id = isId(value.id) ? value.id : null;
  if (value.jsonrpc !== '2.0') return { kind: 'invalid', detail: 'jsonrpc is not "2.0"', id };
  if (typeof value.method === 'string') {
    if (value.id === undefined) return { kind: 'notification', method: value.method };
    if (id !== null) return { kind: 'request', id, method: value.method };
    return { kind: 'invalid', detail: 'request id is not a string or number', id: null };
  }
  if ('result' in value) {
    if (id === null) {
      return { kind: 'invalid', detail: 'response id is not a string or number', id: null };
    }
    if (!isRecord(value.result)) return { kind: 'invalid', detail: 'result is not an object', id };
    return { kind: 'response', id, result: value.result };
  }
  if ('error' in value) {
    const error = value.error;
    if (!isRecord(error) || typeof error.code !== 'number' || !Number.isInteger(error.code)) {
      return { kind: 'invalid', detail: 'error has no integer code', id };
    }
    const message = typeof error.message === 'string' ? error.message : '';
    return { kind: 'error', id, code: error.code, message, data: error.data };
  }
  return { kind: 'invalid', detail: 'message has no method, result or error', id };
}

/** Decodes a JSON text that holds one message or a batch (array) of messages. */
export function decodeMessages(text: string): Incoming[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [{ kind: 'invalid', detail: 'not JSON', id: null }];
  }
  if (Array.isArray(value)) return value.map(classifyMessage);
  return [classifyMessage(value)];
}

export function encodeRequest(
  id: number,
  method: RequestMethod,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!(REQUEST_METHODS as readonly string[]).includes(method)) {
    throw new Error(`mcp-compat refuses to send ${String(method)}`);
  }
  return { jsonrpc: '2.0', id, method, params };
}

export function encodeNotification(
  method: NotificationMethod,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  if (!(NOTIFICATION_METHODS as readonly string[]).includes(method)) {
    throw new Error(`mcp-compat refuses to send ${String(method)}`);
  }
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}

/**
 * The reply to a request the server sent to us. ping gets an empty result; everything else
 * (sampling, elicitation, roots and so on) gets a "method not found" error.
 */
export function replyToServerRequest(id: JsonRpcId, method: string): Record<string, unknown> {
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  return {
    jsonrpc: '2.0',
    id,
    error: { code: METHOD_NOT_FOUND, message: `mcp-compat does not support ${method}` },
  };
}

/** "error -32601: Method not found", plus the supported versions if the error lists them. */
export function describeRpcError(code: number, message: string, data: unknown): string {
  const text = cleanText(message);
  let description = text === '' ? `error ${code}` : `error ${code}: ${text}`;
  if (isRecord(data) && Array.isArray(data.supported)) {
    const supported = data.supported.filter((v): v is string => typeof v === 'string');
    if (supported.length > 0) {
      description += ` (supported: ${supported.map((v) => cleanText(v, 40)).join(', ')})`;
    }
  }
  return description;
}

/** Turns an error or failure outcome into a probe failure with a reason. */
export function outcomeFailure(
  method: string,
  outcome: Exclude<RpcOutcome, { kind: 'result' }>,
): RpcFailure {
  if (outcome.kind === 'failure') return outcome;
  return failure(
    'rpc-error',
    `${method} returned ${describeRpcError(outcome.code, outcome.message, outcome.data)}`,
    { httpStatus: outcome.httpStatus, errorCode: outcome.code },
  );
}
