export interface SseEvent {
  /** The event field, "message" when absent. */
  event: string;
  data: string;
}

/** Incremental parser for text/event-stream bodies (WHATWG HTML, server-sent events). */
export class SseParser {
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];
  private hasData = false;

  /** Feeds decoded text and returns the events completed by it. */
  push(text: string): SseEvent[] {
    this.buffer += text;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // A lone \r at the end may be the first half of \r\n; wait for more text.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.processLine(line);
      if (event) events.push(event);
    }
    return events;
  }

  /** Dispatches a final event that was not followed by a blank line. */
  end(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer !== '') {
      const event = this.processLine(this.buffer);
      this.buffer = '';
      if (event) events.push(event);
    }
    const last = this.dispatch();
    if (last) events.push(last);
    return events;
  }

  private processLine(line: string): SseEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventName = value;
    if (field === 'data') {
      this.dataLines.push(value);
      this.hasData = true;
    }
    return null;
  }

  private dispatch(): SseEvent | null {
    const event = this.hasData
      ? {
          event: this.eventName === '' ? 'message' : this.eventName,
          data: this.dataLines.join('\n'),
        }
      : null;
    this.eventName = '';
    this.dataLines = [];
    this.hasData = false;
    return event;
  }
}

/** Yields the events of an SSE response body until it ends. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    finished = true;
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    if (finished) reader.releaseLock();
    else void reader.cancel().catch(() => undefined);
  }
}
