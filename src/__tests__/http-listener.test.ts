import { createServer } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { listenWithRetry } from '../http-listener.js';

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

describe('listenWithRetry', () => {
  test('retries on next port when base port is occupied', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const blockedPort = (blocker.address() as AddressInfo).port;

    const app = express();
    const logs: string[] = [];
    const { server, port } = await listenWithRetry(app, '127.0.0.1', blockedPort, 2, (message) => logs.push(message));

    expect(port).toBe(blockedPort + 1);
    expect(logs).toContain(`Port ${blockedPort} in use, trying next...`);

    await closeServer(server);
    await closeServer(blocker);
  });

  test('rethrows non-EADDRINUSE listen errors', async () => {
    const app = express();

    await expect(listenWithRetry(app, '127.0.0.1', -1, 1)).rejects.toThrow();
  });
});
