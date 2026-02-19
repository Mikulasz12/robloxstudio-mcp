import { BridgeService } from '../bridge-service.js';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import request from 'supertest';

describe('Smoke Tests - Connection Fixes', () => {
  test('BridgeService should be instantiable', () => {
    const bridge = new BridgeService();
    expect(bridge).toBeDefined();
    expect(bridge.getPendingRequest()).toBeNull();
  });

  test('HTTP server should start and respond to health check', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const httpServer = createHttpServer(tools, bridge);
    const app = httpServer.app;

    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('robloxstudio-mcp');
  });

  test('clearAllPendingRequests should clear all requests', async () => {
    const bridge = new BridgeService();

    const promise1 = bridge.sendRequest('/test1', {});
    const promise2 = bridge.sendRequest('/test2', {});

    expect(bridge.getPendingRequest()).toBeTruthy();

    bridge.clearAllPendingRequests();

    expect(bridge.getPendingRequest()).toBeNull();

    await expect(promise1).rejects.toThrow('Connection closed');
    await expect(promise2).rejects.toThrow('Connection closed');
  });

  test('Disconnect endpoint should clear pending requests', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const httpServer = createHttpServer(tools, bridge);
    const app = httpServer.app;

    const pendingPromise = bridge.sendRequest('/test', { data: 'test' });
    pendingPromise.catch(() => {});

    await request(app)
      .post('/disconnect')
      .expect(200);

    await expect(pendingPromise).rejects.toThrow('Connection closed');
  });

  test('Connection states should update correctly', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const httpServer = createHttpServer(tools, bridge);
    const app = httpServer.app;
    const runtime = httpServer.runtime;

    expect(runtime.isPluginConnected()).toBe(false);

    await request(app).post('/ready').expect(200);
    expect(runtime.isPluginConnected()).toBe(true);

    await request(app).post('/disconnect').expect(200);
    expect(runtime.isPluginConnected()).toBe(false);
  });
});
