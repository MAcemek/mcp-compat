import {
  failure,
  replyToServerRequest,
  encodeRequest,
  type Incoming,
  type JsonRpcId,
  type RpcFailure,
  type RpcOutcome,
} from './jsonrpc.js';
import type { NotificationMethod, RequestMethod } from './protocol.js';
import type { ProbeWarning, SessionMode, TransportId } from './types.js';

/** One fresh connection to the server, used by exactly one probe and then closed. */
export interface Channel {
  readonly transport: TransportId;
  /** Starts the process or opens the stream. Returns a failure, or null when ready. */
  open(): Promise<RpcFailure | null>;
  /** The protocol version for transport headers (MCP-Protocol-Version on HTTP). */
  setProtocolVersion(version: string): void;
  request(method: RequestMethod, params: Record<string, unknown>): Promise<RpcOutcome>;
  notify(method: NotificationMethod, params?: Record<string, unknown>): Promise<RpcFailure | null>;
  /** Streamable HTTP only: whether the server needs Mcp-Session-Id. Other channels return null. */
  checkSession(): Promise<SessionMode | null>;
  reached(): boolean;
  warnings(): ProbeWarning[];
  close(): Promise<void>;
}

/** The time limit of one probe. */
export class Deadline {
  readonly end: number;

  constructor(
    readonly timeoutMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.end = now() + timeoutMs;
  }

  remaining(): number {
    return Math.max(0, this.end - this.now());
  }

  timeoutFailure(method: string): RpcFailure {
    return failure('timeout', `no response to ${method} within ${this.timeoutMs} ms`);
  }
}

/** Collects warnings, keeping the first of each text. */
export class WarningList {
  private readonly items: ProbeWarning[] = [];

  add(warning: ProbeWarning): void {
    if (!this.items.some((item) => item.text === warning.text)) this.items.push(warning);
  }

  list(): ProbeWarning[] {
    return [...this.items];
  }
}

interface Pending {
  method: string;
  resolve: (outcome: RpcOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Request/response correlation for message-stream transports (stdio and HTTP+SSE). Replies to
 * requests from the server and ignores notifications.
 */
export class RpcSession {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private closedWith: ((method: string) => RpcFailure) | null = null;

  constructor(
    /** Sends one message. Returns a failure if it could not be delivered. */
    private readonly transmit: (message: Record<string, unknown>) => Promise<RpcFailure | null>,
    private readonly deadline: Deadline,
    private readonly warnings: WarningList,
  ) {}

  async request(method: RequestMethod, params: Record<string, unknown>): Promise<RpcOutcome> {
    if (this.closedWith) return this.closedWith(method);
    const id = this.nextId++;
    const message = encodeRequest(id, method, params);
    const outcome = new Promise<RpcOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(this.deadline.timeoutFailure(method));
      }, this.deadline.remaining());
      this.pending.set(id, { method, resolve, timer });
    });
    const sendFailure = await this.transmit(message);
    if (sendFailure) this.settle(id, sendFailure);
    return outcome;
  }

  receive(message: Incoming): void {
    switch (message.kind) {
      case 'response':
        if (
          !this.settle(message.id, { kind: 'result', result: message.result, httpStatus: null })
        ) {
          this.unknownId();
        }
        return;
      case 'error': {
        // An error without an id answers the only pending request, if there is exactly one.
        const id = message.id ?? (this.pending.size === 1 ? [...this.pending.keys()][0] : null);
        const outcome: RpcOutcome = {
          kind: 'error',
          code: message.code,
          message: message.message,
          data: message.data,
          httpStatus: null,
        };
        if (id === null || id === undefined || !this.settle(id, outcome)) this.unknownId();
        return;
      }
      case 'request':
        void this.transmit(replyToServerRequest(message.id, message.method));
        return;
      case 'notification':
        return;
      case 'invalid': {
        const entry = message.id === null ? undefined : this.pending.get(message.id);
        if (entry && message.id !== null) {
          this.settle(
            message.id,
            failure('invalid', `invalid ${entry.method} response: ${message.detail}`),
          );
          return;
        }
        this.warnings.add({
          id: 'invalid-message',
          text: `server sent an invalid JSON-RPC message (${message.detail})`,
        });
        return;
      }
    }
  }

  /** Fails every pending and future request with the failure that `make` builds for its method. */
  closeWith(make: (method: string) => RpcFailure): void {
    if (this.closedWith) return;
    this.closedWith = make;
    for (const [id, entry] of [...this.pending.entries()]) this.settle(id, make(entry.method));
  }

  private settle(id: JsonRpcId, outcome: RpcOutcome): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(outcome);
    return true;
  }

  private unknownId(): void {
    this.warnings.add({
      id: 'invalid-message',
      text: 'server sent a response with an id that matches no request',
    });
  }
}
