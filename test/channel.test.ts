import { describe, expect, it } from 'vitest';
import { Deadline, RpcSession, WarningList } from '../src/channel.js';
import { failure } from '../src/jsonrpc.js';

function session(timeoutMs = 1000) {
  const sent: Record<string, unknown>[] = [];
  const warnings = new WarningList();
  const rpc = new RpcSession(
    async (message) => {
      sent.push(message);
      return null;
    },
    new Deadline(timeoutMs),
    warnings,
  );
  return { rpc, sent, warnings };
}

describe('RpcSession', () => {
  it('matches responses to requests by id', async () => {
    const { rpc, sent } = session();
    const pending = rpc.request('tools/list', {});
    await Promise.resolve();
    expect(sent).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
    rpc.receive({ kind: 'response', id: 1, result: { tools: [] } });
    expect(await pending).toEqual({ kind: 'result', result: { tools: [] }, httpStatus: null });
  });

  it('gives an error without an id to the only pending request', async () => {
    const { rpc } = session();
    const pending = rpc.request('initialize', {});
    rpc.receive({ kind: 'error', id: null, code: -32700, message: 'Parse error', data: undefined });
    expect(await pending).toMatchObject({ kind: 'error', code: -32700 });
  });

  it('fails a request whose response is malformed', async () => {
    const { rpc } = session();
    const pending = rpc.request('initialize', {});
    rpc.receive({ kind: 'invalid', detail: 'result is not an object', id: 1 });
    expect(await pending).toEqual(
      failure('invalid', 'invalid initialize response: result is not an object'),
    );
  });

  it('answers server requests and warns about unknown ids', async () => {
    const { rpc, sent, warnings } = session();
    rpc.receive({ kind: 'request', id: 'r1', method: 'elicitation/create' });
    rpc.receive({ kind: 'response', id: 99, result: {} });
    await Promise.resolve();
    expect(sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 'r1',
        error: { code: -32601, message: 'mcp-compat does not support elicitation/create' },
      },
    ]);
    expect(warnings.list()).toEqual([
      { id: 'invalid-message', text: 'server sent a response with an id that matches no request' },
    ]);
  });

  it('times out at the deadline and fails everything after closeWith', async () => {
    const { rpc } = session(50);
    expect(await rpc.request('ping', {})).toEqual(
      failure('timeout', 'no response to ping within 50 ms'),
    );
    rpc.closeWith((method) => failure('exited', `gone before ${method}`));
    expect(await rpc.request('tools/list', {})).toEqual(
      failure('exited', 'gone before tools/list'),
    );
  });
});
