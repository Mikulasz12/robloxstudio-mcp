export interface SessionTransportLike {
  sessionId?: string;
  onclose?: (() => void) | undefined;
}

export interface SessionServerLike {
  close: () => Promise<void>;
}

export interface SessionContextLike<TTransport extends SessionTransportLike = SessionTransportLike> {
  server: SessionServerLike;
  transport: TTransport;
}

export function removeSessionContext<TContext extends SessionContextLike>(
  sessions: Map<string, TContext>,
  context: TContext
) {
  const activeSessionId = context.transport.sessionId;
  if (activeSessionId && sessions.get(activeSessionId) === context) {
    sessions.delete(activeSessionId);
    return;
  }

  for (const [sessionKey, sessionContext] of sessions.entries()) {
    if (sessionContext === context || sessionContext.transport === context.transport) {
      sessions.delete(sessionKey);
      break;
    }
  }
}

export function attachSessionCloseHandler<TContext extends SessionContextLike>(
  sessions: Map<string, TContext>,
  context: TContext,
  log: (message: string) => void = console.error
) {
  let cleanedUp = false;

  context.transport.onclose = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    removeSessionContext(sessions, context);

    // Defer close so Protocol._onclose can complete first and avoid recursive close chains.
    queueMicrotask(() => {
      context.server.close().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to close MCP session server: ${message}`);
      });
    });
  };
}
