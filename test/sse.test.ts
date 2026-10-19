import { describe, expect, it } from 'vitest';
import { readSseEvents, SseParser } from '../src/transports/sse.js';

describe('SseParser', () => {
  it('parses events, comments and multi-line data', () => {
    const parser = new SseParser();
    expect(
      parser.push(': comment\n\nevent: endpoint\ndata: /messages?id=1\n\ndata: a\ndata:b\n\n'),
    ).toEqual([
      { event: 'endpoint', data: '/messages?id=1' },
      { event: 'message', data: 'a\nb' },
    ]);
  });

  it('handles CRLF and chunks split anywhere', () => {
    const parser = new SseParser();
    const text = 'event: message\r\ndata: {"x":1}\r\n\r\n';
    const events = [...text].flatMap((char) => parser.push(char));
    expect(events).toEqual([{ event: 'message', data: '{"x":1}' }]);
  });

  it('dispatches a final event without a trailing blank line at the end', () => {
    const parser = new SseParser();
    expect(parser.push('data: last')).toEqual([]);
    expect(parser.end()).toEqual([{ event: 'message', data: 'last' }]);
  });

  it('ignores events without data', () => {
    const parser = new SseParser();
    expect(parser.push('event: ping\n\n')).toEqual([]);
  });
});

describe('readSseEvents', () => {
  it('reads events from a stream', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: one\n\nda'));
        controller.enqueue(encoder.encode('ta: two\n\n'));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readSseEvents(body)) events.push(event.data);
    expect(events).toEqual(['one', 'two']);
  });
});
