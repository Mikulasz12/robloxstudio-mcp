import { createServer, type Server as HttpServer } from 'http';
import type { Express } from 'express';

const DEFAULT_PORT_ATTEMPTS = 5;

export interface ListenWithRetryResult {
  server: HttpServer;
  port: number;
}

function listenOnPort(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function listenWithRetry(
  app: Express,
  host: string,
  startPort: number,
  maxAttempts: number = DEFAULT_PORT_ATTEMPTS,
  log: (message: string) => void = console.error
): Promise<ListenWithRetryResult> {
  const attempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : DEFAULT_PORT_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const port = startPort + attempt;
    const server = createServer(app);

    try {
      await listenOnPort(server, port, host);
      return { server, port };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EADDRINUSE' && attempt < attempts - 1) {
        log(`Port ${port} in use, trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to bind HTTP server after ${attempts} attempts starting at port ${startPort}`);
}
