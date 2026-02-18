import {
  attachSessionCloseHandler,
  removeSessionContext,
  type SessionContextLike,
  type SessionTransportLike,
} from '../streamable-session-lifecycle.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('streamable session lifecycle', () => {
  test('removeSessionContext deletes by active session id', () => {
    const transport: SessionTransportLike = { sessionId: 'session-1' };
    const context: SessionContextLike = {
      transport,
      server: { close: jest.fn().mockResolvedValue(undefined) },
    };
    const sessions = new Map<string, SessionContextLike>([['session-1', context]]);

    removeSessionContext(sessions, context);

    expect(sessions.size).toBe(0);
  });

  test('removeSessionContext falls back to transport identity', () => {
    const transport: SessionTransportLike = {};
    const context: SessionContextLike = {
      transport,
      server: { close: jest.fn().mockResolvedValue(undefined) },
    };
    const sessions = new Map<string, SessionContextLike>([['orphaned-key', context]]);

    removeSessionContext(sessions, context);

    expect(sessions.size).toBe(0);
  });

  test('attachSessionCloseHandler cleans map and closes once', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const transport: SessionTransportLike = { sessionId: 'session-2' };
    const context: SessionContextLike = { transport, server: { close } };
    const sessions = new Map<string, SessionContextLike>([['session-2', context]]);

    attachSessionCloseHandler(sessions, context);
    const onclose = transport.onclose;
    expect(onclose).toBeDefined();

    onclose?.();
    onclose?.();
    await flushMicrotasks();

    expect(sessions.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('attachSessionCloseHandler logs close errors', async () => {
    const close = jest.fn().mockRejectedValue(new Error('close failed'));
    const log = jest.fn();
    const transport: SessionTransportLike = { sessionId: 'session-3' };
    const context: SessionContextLike = { transport, server: { close } };
    const sessions = new Map<string, SessionContextLike>([['session-3', context]]);

    attachSessionCloseHandler(sessions, context, log);
    transport.onclose?.();
    await flushMicrotasks();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to close MCP session server: close failed'));
  });
});
