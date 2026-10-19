import type { Deadline } from '../channel.js';
import { decodeMessages, describeRpcError, failure, type RpcFailure } from '../jsonrpc.js';
import { cleanText, isRecord } from '../sanitize.js';
import type { HeaderPair } from '../types.js';

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Headers mcp-compat sets itself. --header may not override them. */
export const RESERVED_HEADER_NAMES = [
  'accept',
  'content-type',
  'last-event-id',
  'mcp-method',
  'mcp-name',
  'mcp-protocol-version',
  'mcp-session-id',
];

/** Largest error body read from a failed HTTP response. */
const ERROR_BODY_LIMIT = 64 * 1024;

export function headerRecord(pairs: HeaderPair[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { name, value } of pairs) record[name] = value;
  return record;
}

/** "could not connect: ECONNREFUSED" from a fetch rejection. */
export function networkFailure(error: unknown): RpcFailure {
  let detail = 'request failed';
  if (error instanceof Error) {
    const cause: unknown = (error as Error & { cause?: unknown }).cause;
    if (isRecord(cause) && typeof cause.code === 'string') detail = cause.code;
    else if (cause instanceof Error && cause.message !== '') detail = cleanText(cause.message);
    else if (error.message !== '') detail = cleanText(error.message);
  }
  return failure('network', `could not connect: ${detail}`);
}

export interface Exchange {
  response: Response;
  /** Aborts the request, including a body that is still streaming. */
  abort(): void;
}

/**
 * Sends one HTTP request that is aborted when the probe deadline passes. The deadline keeps
 * applying while the body is read; call abort() when done with the response.
 */
export async function exchange(
  fetchFn: FetchFn,
  url: URL,
  init: RequestInit,
  deadline: Deadline,
  method: string,
): Promise<Exchange | RpcFailure> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadline.remaining());
  const abort = (): void => {
    clearTimeout(timer);
    controller.abort();
  };
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal, redirect: 'manual' });
    return { response, abort };
  } catch (error) {
    abort();
    return timedOut ? deadline.timeoutFailure(method) : networkFailure(error);
  }
}

/** Reads at most `limit` bytes of a body as text. Returns '' if the body cannot be read. */
export async function readBodyText(response: Response, limit = ERROR_BODY_LIMIT): Promise<string> {
  if (!response.body) return '';
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (size < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Aborted or reset; use what arrived.
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text;
}

/**
 * A failure for a non-2xx response, using the JSON-RPC error in the body if there is one.
 * Redirects are not followed, so that headers are never sent to another URL.
 */
export async function responseFailure(method: string, response: Response): Promise<RpcFailure> {
  const status = response.status;
  const location = response.headers.get('location');
  if (status >= 300 && status < 400 && location !== null) {
    void response.body?.cancel().catch(() => undefined);
    return failure(
      'http',
      `${method} returned HTTP ${status} (redirect to ${cleanText(location, 120)})`,
      { httpStatus: status },
    );
  }
  return httpStatusFailure(method, status, await readBodyText(response));
}

export function httpStatusFailure(method: string, status: number, body: string): RpcFailure {
  for (const message of decodeMessages(body)) {
    if (message.kind === 'error') {
      return failure(
        'http',
        `${method} returned HTTP ${status} with ${describeRpcError(message.code, message.message, message.data)}`,
        { httpStatus: status, errorCode: message.code },
      );
    }
  }
  return failure('http', `${method} returned HTTP ${status}`, { httpStatus: status });
}

export function contentType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}
