import { describe, expect, it } from 'vitest';
import {
  classifyMessage,
  decodeMessages,
  describeRpcError,
  encodeNotification,
  encodeRequest,
  replyToServerRequest,
} from '../src/jsonrpc.js';
import type { NotificationMethod, RequestMethod } from '../src/protocol.js';

describe('classifyMessage', () => {
  it('recognizes responses, errors, requests and notifications', () => {
    expect(classifyMessage({ jsonrpc: '2.0', id: 1, result: { a: 1 } })).toEqual({
      kind: 'response',
      id: 1,
      result: { a: 1 },
    });
    expect(
      classifyMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse' } }),
    ).toEqual({ kind: 'error', id: null, code: -32700, message: 'Parse', data: undefined });
    expect(classifyMessage({ jsonrpc: '2.0', id: 'x', method: 'ping' })).toEqual({
      kind: 'request',
      id: 'x',
      method: 'ping',
    });
    expect(classifyMessage({ jsonrpc: '2.0', method: 'notifications/message' })).toEqual({
      kind: 'notification',
      method: 'notifications/message',
    });
  });

  it('reports invalid messages and keeps a readable id', () => {
    expect(classifyMessage('text')).toEqual({
      kind: 'invalid',
      detail: 'message is not a JSON object',
      id: null,
    });
    expect(classifyMessage({ id: 1, result: {} })).toEqual({
      kind: 'invalid',
      detail: 'jsonrpc is not "2.0"',
      id: 1,
    });
    expect(classifyMessage({ jsonrpc: '2.0', id: 2, result: 'oops' })).toEqual({
      kind: 'invalid',
      detail: 'result is not an object',
      id: 2,
    });
    expect(classifyMessage({ jsonrpc: '2.0', id: 3, error: { message: 'x' } })).toEqual({
      kind: 'invalid',
      detail: 'error has no integer code',
      id: 3,
    });
    expect(classifyMessage({ jsonrpc: '2.0', id: 4 })).toEqual({
      kind: 'invalid',
      detail: 'message has no method, result or error',
      id: 4,
    });
  });
});

describe('decodeMessages', () => {
  it('decodes single messages and batches', () => {
    expect(decodeMessages('not json')).toEqual([{ kind: 'invalid', detail: 'not JSON', id: null }]);
    expect(
      decodeMessages('[{"jsonrpc":"2.0","method":"a"},{"jsonrpc":"2.0","method":"b"}]'),
    ).toEqual([
      { kind: 'notification', method: 'a' },
      { kind: 'notification', method: 'b' },
    ]);
  });
});

describe('encoding', () => {
  it('builds requests and notifications', () => {
    expect(encodeRequest(1, 'tools/list', {})).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(encodeNotification('notifications/initialized')).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it('refuses methods that could have side effects', () => {
    for (const method of ['tools/call', 'resources/read', 'prompts/get', 'completion/complete']) {
      expect(() => encodeRequest(1, method as RequestMethod, {})).toThrow(
        `mcp-compat refuses to send ${method}`,
      );
    }
    expect(() => encodeNotification('notifications/cancelled' as NotificationMethod)).toThrow(
      'mcp-compat refuses to send notifications/cancelled',
    );
  });
});

describe('replyToServerRequest', () => {
  it('answers ping and rejects everything else', () => {
    expect(replyToServerRequest(7, 'ping')).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
    expect(replyToServerRequest('s', 'sampling/createMessage')).toEqual({
      jsonrpc: '2.0',
      id: 's',
      error: { code: -32601, message: 'mcp-compat does not support sampling/createMessage' },
    });
  });
});

describe('describeRpcError', () => {
  it('includes the supported versions and removes control characters', () => {
    expect(
      describeRpcError(-32022, 'Unsupported\u001b[31m version', { supported: ['2026-07-28'] }),
    ).toBe('error -32022: Unsupported [31m version (supported: 2026-07-28)');
    expect(describeRpcError(-32601, '', undefined)).toBe('error -32601');
  });
});
