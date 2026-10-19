import type { ChildProcessWithoutNullStreams } from 'node:child_process';
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
import { shutdownProcess, spawnShellCommand } from './process-tree.js';

/** How long a server gets to exit after its stdin is closed. */
export const STDIO_GRACE_MS = 1000;

/** Longest stdout line accepted before the server is treated as broken. */
export const MAX_LINE_LENGTH = 16 * 1024 * 1024;

const STDERR_TAIL = 4096;

export interface StdioChannelOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  platform?: NodeJS.Platform;
  graceMs?: number;
}

/** A newline-delimited JSON-RPC connection to a freshly started server process. */
export class StdioChannel implements Channel {
  readonly transport = 'stdio' as const;
  private readonly deadline: Deadline;
  private readonly warningList = new WarningList();
  private readonly session: RpcSession;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stderrTail = '';
  private sawOutput = false;
  private exited = false;
  private timedOut = false;
  private closed = false;

  constructor(private readonly options: StdioChannelOptions) {
    this.deadline = new Deadline(options.timeoutMs);
    this.session = new RpcSession(
      (message) => this.transmit(message),
      this.deadline,
      this.warningList,
    );
  }

  open(): Promise<RpcFailure | null> {
    const child = spawnShellCommand(this.options.command, this.options.cwd, this.options.platform);
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL);
    });
    child.stdin.on('error', () => {
      // EPIPE when the server has exited; the close event reports it.
    });
    child.once('error', (error) => {
      this.exited = true;
      this.session.closeWith(() =>
        failure('exited', `could not start the server: ${cleanText(error.message)}`),
      );
    });
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.exited = true;
      const how =
        code !== null ? `exited with code ${code}` : `was stopped by ${signal ?? 'a signal'}`;
      const stderr = this.lastStderrLine();
      const detail = stderr === '' ? '' : ` (stderr: ${stderr})`;
      this.session.closeWith((method) =>
        failure('exited', `server ${how} before answering ${method}${detail}`),
      );
    });
    return Promise.resolve(null);
  }

  setProtocolVersion(): void {
    // stdio carries the version in the message body only.
  }

  async request(method: RequestMethod, params: Record<string, unknown>): Promise<RpcOutcome> {
    const outcome = await this.session.request(method, params);
    if (outcome.kind === 'failure' && outcome.failure === 'timeout') this.timedOut = true;
    return outcome;
  }

  notify(method: NotificationMethod, params?: Record<string, unknown>): Promise<RpcFailure | null> {
    return this.transmit(encodeNotification(method, params));
  }

  checkSession(): Promise<SessionMode | null> {
    return Promise.resolve(null);
  }

  reached(): boolean {
    return this.sawOutput || (this.child !== null && !this.exited);
  }

  warnings(): ProbeWarning[] {
    return this.warningList.list();
  }

  async close(): Promise<void> {
    if (this.closed || !this.child) return;
    this.closed = true;
    const child = this.child;
    const graceMs = this.timedOut ? 0 : (this.options.graceMs ?? STDIO_GRACE_MS);
    await shutdownProcess(child, graceMs, this.options.platform);
    child.stdout.destroy();
    child.stderr.destroy();
  }

  private transmit(message: Record<string, unknown>): Promise<RpcFailure | null> {
    const child = this.child;
    if (!child || this.exited || child.stdin.destroyed) {
      return Promise.resolve(failure('exited', 'server is not running'));
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return Promise.resolve(null);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.buffer = '';
      this.session.closeWith((method) =>
        failure('invalid', `invalid ${method} response: a stdout line is longer than 16 MiB`),
      );
    }
  }

  private onLine(line: string): void {
    if (line.trim() === '') return;
    this.sawOutput = true;
    for (const message of decodeMessages(line)) {
      if (message.kind === 'invalid' && message.detail === 'not JSON') {
        this.warningList.add({
          id: 'stdout-noise',
          text: 'server wrote text that is not JSON-RPC to stdout',
        });
      } else {
        this.session.receive(message);
      }
    }
  }

  private lastStderrLine(): string {
    const lines = this.stderrTail.split(/\r?\n/).filter((line) => line.trim() !== '');
    const last = lines[lines.length - 1];
    return last === undefined ? '' : cleanText(last);
  }
}
