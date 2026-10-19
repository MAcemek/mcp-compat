import { Deadline, WarningList, type Channel } from '../channel.js';
import {
  decodeMessages,
  encodeNotification,
  encodeRequest,
  failure,
  replyToServerRequest,
  type Incoming,
  type RpcFailure,
  type RpcOutcome,
} from '../jsonrpc.js';
import type { Era, NotificationMethod, RequestMethod } from '../protocol.js';
import type { HeaderPair, ProbeWarning, SessionMode } from '../types.js';
import {
  contentType,
  exchange,
  headerRecord,
  networkFailure,
  readBodyText,
  responseFailure,
  type FetchFn,
} from './http-common.js';
import { readSseEvents } from './sse.js';

/** Largest JSON response body accepted. */
const MAX_BODY = 16 * 1024 * 1024;

/** Time limit for the DELETE that ends a session. */
const DELETE_TIMEOUT_MS = 2000;

export interface HttpChannelOptions {
  url: URL;
  headers: HeaderPair[];
  timeoutMs: number;
  fetch: FetchFn;
}

/**
 * Streamable HTTP: every message is its own POST to the MCP endpoint. Legacy probes keep the
 * Mcp-Session-Id the server issues; modern probes send Mcp-Method and never send a session.
 */
export class StreamableHttpChannel implements Channel {
  readonly transport = 'streamable-http' as const;
  private readonly deadline: Deadline;
  private readonly warningList = new WarningList();
  private nextId = 1;
  private protocolVersion: string | null = null;
  private sessionId: string | null = null;
  private sawResponse = false;
  private closed = false;

  constructor(
    private readonly options: HttpChannelOptions,
    private readonly era: Era,
  ) {
    this.deadline = new Deadline(options.timeoutMs);
  }

  open(): Promise<RpcFailure | null> {
    return Promise.resolve(null);
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  request(method: RequestMethod, params: Record<string, unknown>): Promise<RpcOutcome> {
    const id = this.nextId++;
    return this.post(method, encodeRequest(id, method, params), id, true);
  }

  async notify(
    method: NotificationMethod,
    params?: Record<string, unknown>,
  ): Promise<RpcFailure | null> {
    const sent = await this.send(method, encodeNotification(method, params), true);
    if (!('response' in sent)) return sent;
    try {
      return sent.response.ok ? null : await responseFailure(method, sent.response);
    } finally {
      sent.abort();
    }
  }

  async checkSession(): Promise<SessionMode | null> {
    if (this.era !== 'legacy') return null;
    if (this.sessionId === null) return 'none';
    const id = this.nextId++;
    const outcome = await this.post('ping', encodeRequest(id, 'ping', {}), id, false);
    if (outcome.kind === 'result') return 'optional';
    if (outcome.kind === 'failure' && outcome.failure !== 'http' && outcome.failure !== 'invalid') {
      return null;
    }
    return 'required';
  }

  reached(): boolean {
    return this.sawResponse;
  }

  warnings(): ProbeWarning[] {
    return this.warningList.list();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId === null) return;
    const result = await exchange(
      this.options.fetch,
      this.options.url,
      { method: 'DELETE', headers: this.headers('', true) },
      new Deadline(Math.min(DELETE_TIMEOUT_MS, this.options.timeoutMs)),
      'DELETE',
    );
    if ('response' in result) {
      void result.response.body?.cancel().catch(() => undefined);
      result.abort();
    }
  }

  private headers(method: string, withSession: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      ...headerRecord(this.options.headers),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.protocolVersion !== null && method !== 'initialize') {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
    }
    if (this.era === 'modern' && method !== '') headers['Mcp-Method'] = method;
    if (withSession && this.sessionId !== null) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  private async send(
    method: string,
    message: Record<string, unknown>,
    withSession: boolean,
  ): Promise<{ response: Response; abort: () => void } | RpcFailure> {
    const result = await exchange(
      this.options.fetch,
      this.options.url,
      {
        method: 'POST',
        headers: this.headers(method, withSession),
        body: JSON.stringify(message),
      },
      this.deadline,
      method,
    );
    if (!('response' in result)) return result;
    this.sawResponse = true;
    const sessionHeader = result.response.headers.get('mcp-session-id');
    if (this.era === 'legacy' && method === 'initialize' && sessionHeader !== null) {
      this.sessionId = sessionHeader;
    }
    if (this.era === 'modern' && sessionHeader !== null) {
      this.warningList.add({
        id: 'session-on-modern',
        text: 'server sent Mcp-Session-Id on a 2026-07-28 response',
      });
    }
    return result;
  }

  private async post(
    method: RequestMethod,
    message: Record<string, unknown>,
    id: number,
    withSession: boolean,
  ): Promise<RpcOutcome> {
    const sent = await this.send(method, message, withSession);
    if (!('response' in sent)) return sent;
    const { response } = sent;
    try {
      if (!response.ok) return await responseFailure(method, response);
      const type = contentType(response);
      if (response.status === 202 || !response.body) {
        return failure(
          'invalid',
          `invalid ${method} response: HTTP ${response.status} without a JSON-RPC response`,
          { httpStatus: response.status },
        );
      }
      if (type === 'application/json') {
        const messages = decodeMessages(await readBodyText(response, MAX_BODY));
        for (const incoming of messages) {
          const outcome = this.consider(method, incoming, id, response.status);
          if (outcome) return outcome;
        }
        return failure('invalid', `invalid ${method} response: no response with the request id`, {
          httpStatus: response.status,
        });
      }
      if (type === 'text/event-stream') {
        for await (const event of readSseEvents(response.body)) {
          if (event.data.trim() === '') continue;
          for (const incoming of decodeMessages(event.data)) {
            const outcome = this.consider(method, incoming, id, response.status);
            if (outcome) return outcome;
          }
        }
        return failure(
          'invalid',
          `invalid ${method} response: the event stream ended without a response`,
          { httpStatus: response.status },
        );
      }
      return failure(
        'invalid',
        `invalid ${method} response: unexpected content type ${type === '' ? '(none)' : type}`,
        { httpStatus: response.status },
      );
    } catch (error) {
      return this.deadline.remaining() === 0
        ? this.deadline.timeoutFailure(method)
        : networkFailure(error);
    } finally {
      sent.abort();
    }
  }

  /** Returns the outcome when `incoming` answers request `id`; handles anything else. */
  private consider(
    method: string,
    incoming: Incoming,
    id: number,
    httpStatus: number,
  ): RpcOutcome | null {
    switch (incoming.kind) {
      case 'response':
        if (incoming.id === id) return { kind: 'result', result: incoming.result, httpStatus };
        this.warningList.add({
          id: 'invalid-message',
          text: 'server sent a response with an id that matches no request',
        });
        return null;
      case 'error':
        if (incoming.id === id || incoming.id === null) {
          return {
            kind: 'error',
            code: incoming.code,
            message: incoming.message,
            data: incoming.data,
            httpStatus,
          };
        }
        return null;
      case 'request':
        void this.reply(replyToServerRequest(incoming.id, incoming.method));
        return null;
      case 'notification':
        return null;
      case 'invalid':
        if (incoming.id === id) {
          return failure('invalid', `invalid ${method} response: ${incoming.detail}`, {
            httpStatus,
          });
        }
        this.warningList.add({
          id: 'invalid-message',
          text: `server sent an invalid JSON-RPC message (${incoming.detail})`,
        });
        return null;
    }
  }

  private async reply(message: Record<string, unknown>): Promise<void> {
    const sent = await this.send('', message, true);
    if ('response' in sent) {
      void sent.response.body?.cancel().catch(() => undefined);
      sent.abort();
    }
  }
}
