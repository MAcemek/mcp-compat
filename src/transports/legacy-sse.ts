import { Deadline, RpcSession, WarningList, type Channel } from '../channel.js';
import {
  decodeMessages,
  encodeNotification,
  failure,
  type RpcFailure,
  type RpcOutcome,
} from '../jsonrpc.js';
import type { NotificationMethod, RequestMethod } from '../protocol.js';
import { cleanText } from '../sanitize.js';
import type { ProbeWarning, SessionMode } from '../types.js';
import {
  contentType,
  exchange,
  headerRecord,
  responseFailure,
  type Exchange,
} from './http-common.js';
import type { HttpChannelOptions } from './streamable-http.js';
import { readSseEvents } from './sse.js';

/**
 * The deprecated HTTP+SSE transport (2024-11-05): a GET opens an event stream whose first
 * event names the URL to POST messages to; responses arrive as "message" events.
 */
export class LegacySseChannel implements Channel {
  readonly transport = 'http-sse' as const;
  private readonly deadline: Deadline;
  private readonly warningList = new WarningList();
  private readonly session: RpcSession;
  private stream: Exchange | null = null;
  private endpoint: URL | null = null;
  private sawResponse = false;
  private closed = false;

  constructor(private readonly options: HttpChannelOptions) {
    this.deadline = new Deadline(options.timeoutMs);
    this.session = new RpcSession((message) => this.post(message), this.deadline, this.warningList);
  }

  async open(): Promise<RpcFailure | null> {
    const result = await exchange(
      this.options.fetch,
      this.options.url,
      {
        method: 'GET',
        headers: { ...headerRecord(this.options.headers), Accept: 'text/event-stream' },
      },
      this.deadline,
      'GET',
    );
    if (!('response' in result)) return result;
    this.sawResponse = true;
    this.stream = result;
    const { response } = result;
    if (!response.ok) return responseFailure('GET', response);
    const type = contentType(response);
    if (type !== 'text/event-stream' || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      return failure(
        'invalid',
        `GET did not return an event stream (content type ${type === '' ? '(none)' : type})`,
        { httpStatus: response.status },
      );
    }
    return this.waitForEndpoint(response.body);
  }

  setProtocolVersion(): void {
    // HTTP+SSE has no protocol version header.
  }

  request(method: RequestMethod, params: Record<string, unknown>): Promise<RpcOutcome> {
    return this.session.request(method, params);
  }

  notify(method: NotificationMethod, params?: Record<string, unknown>): Promise<RpcFailure | null> {
    return this.post(encodeNotification(method, params));
  }

  checkSession(): Promise<SessionMode | null> {
    return Promise.resolve(null);
  }

  reached(): boolean {
    return this.sawResponse;
  }

  warnings(): ProbeWarning[] {
    return this.warningList.list();
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.stream?.abort();
      this.session.closeWith((method) =>
        failure('exited', `the event stream closed before ${method}`),
      );
    }
    return Promise.resolve();
  }

  private waitForEndpoint(body: ReadableStream<Uint8Array>): Promise<RpcFailure | null> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: RpcFailure | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(
        () => settle(failure('timeout', `no endpoint event within ${this.deadline.timeoutMs} ms`)),
        this.deadline.remaining(),
      );
      const read = async (): Promise<void> => {
        try {
          for await (const event of readSseEvents(body)) {
            if (this.endpoint === null) {
              if (event.event !== 'endpoint') continue;
              const endpoint = this.resolveEndpoint(event.data);
              if (typeof endpoint === 'string') {
                settle(failure('invalid', endpoint));
                return;
              }
              this.endpoint = endpoint;
              settle(null);
            } else if (event.event === 'message') {
              for (const message of decodeMessages(event.data)) this.session.receive(message);
            }
          }
          settle(failure('invalid', 'the event stream ended before an endpoint event'));
        } catch {
          settle(failure('invalid', 'the event stream failed before an endpoint event'));
        }
        // When the deadline aborted the stream, the pending requests report the timeout.
        if (this.deadline.remaining() > 0) {
          this.session.closeWith((method) =>
            failure('exited', `the event stream closed before the response to ${method}`),
          );
        }
      };
      void read();
    });
  }

  /** Resolves the endpoint against the stream URL. Returns a reason string when unusable. */
  private resolveEndpoint(data: string): URL | string {
    let endpoint: URL;
    try {
      endpoint = new URL(data.trim(), this.options.url);
    } catch {
      return `endpoint event is not a URL: ${cleanText(data, 80)}`;
    }
    if (endpoint.origin !== this.options.url.origin) {
      return 'endpoint event points to another origin; mcp-compat does not send requests there';
    }
    return endpoint;
  }

  private async post(message: Record<string, unknown>): Promise<RpcFailure | null> {
    const endpoint = this.endpoint;
    const method = typeof message.method === 'string' ? message.method : 'response';
    if (endpoint === null || this.closed) return failure('exited', `the event stream is closed`);
    const result = await exchange(
      this.options.fetch,
      endpoint,
      {
        method: 'POST',
        headers: { ...headerRecord(this.options.headers), 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
      this.deadline,
      method,
    );
    if (!('response' in result)) return result;
    try {
      if (!result.response.ok) return await responseFailure(method, result.response);
      void result.response.body?.cancel().catch(() => undefined);
      return null;
    } finally {
      result.abort();
    }
  }
}
