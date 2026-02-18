import request from 'supertest';
import { createHttpServer } from '../http-server';
import { RobloxStudioTools } from '../tools/index';
import { BridgeService } from '../bridge-service';
import { Application } from 'express';

describe('HTTP Server', () => {
  let app: Application & any;
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
    app = createHttpServer(tools, bridge);
  });

  afterEach(() => {

    bridge.clearAllPendingRequests();
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'robloxstudio-mcp',
        pluginConnected: false,
        mcpServerActive: false
      });
    });
  });

  describe('Plugin Connection Management', () => {
    test('should handle plugin ready notification', async () => {
      const response = await request(app)
        .post('/ready')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(app.isPluginConnected()).toBe(true);
    });

    test('should handle plugin disconnect', async () => {

      await request(app).post('/ready').expect(200);
      expect(app.isPluginConnected()).toBe(true);

      const response = await request(app)
        .post('/disconnect')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(app.isPluginConnected()).toBe(false);
    });

    test('should clear pending requests on disconnect', async () => {

      const p1 = bridge.sendRequest('/api/test1', {});
      const p2 = bridge.sendRequest('/api/test2', {});
      p1.catch(() => {});
      p2.catch(() => {});

      expect(bridge.getPendingRequest()).toBeTruthy();

      await request(app).post('/disconnect').expect(200);

      expect(bridge.getPendingRequest()).toBeNull();
    });

    test('should timeout plugin connection after inactivity', async () => {

      await request(app).post('/ready').expect(200);
      expect(app.isPluginConnected()).toBe(true);

      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + 11000);

      expect(app.isPluginConnected()).toBe(false);

      Date.now = originalDateNow;
    });
  });

  describe('Polling Endpoint', () => {
    test('should return 503 when MCP server is not active', async () => {
      const response = await request(app)
        .get('/poll')
        .expect(503);

      expect(response.body).toMatchObject({
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        request: null
      });
    });

    test('should return pending request when MCP is active', async () => {

      app.setMCPServerActive(true);

      const pendingRequest = bridge.sendRequest('/api/test', { data: 'test' });
      pendingRequest.catch(() => {});

      const response = await request(app)
        .get('/poll')
        .expect(200);

      expect(response.body).toMatchObject({
        request: {
          endpoint: '/api/test',
          data: { data: 'test' }
        },
        mcpConnected: true,
        pluginConnected: true
      });
      expect(response.body.requestId).toBeTruthy();
    });

    test('should return null request when no pending requests', async () => {

      app.setMCPServerActive(true);

      const response = await request(app)
        .get('/poll')
        .expect(200);

      expect(response.body).toMatchObject({
        request: null,
        mcpConnected: true,
        pluginConnected: true
      });
    });

    test('should mark plugin as connected when polling', async () => {
      expect(app.isPluginConnected()).toBe(false);

      await request(app).get('/poll').expect(503);

      expect(app.isPluginConnected()).toBe(true);
    });

    test('should reject poll from different studio instance when bridge is already bound', async () => {
      app.setMCPServerActive(true);

      await request(app)
        .post('/ready')
        .send({ studioInstanceId: 'studio-a', placeId: '1', placeName: 'Project A' })
        .expect(200);

      const response = await request(app)
        .get('/poll')
        .query({ studioInstanceId: 'studio-b', placeId: '2', placeName: 'Project B' })
        .expect(409);

      expect(response.body).toMatchObject({
        error: 'Studio instance mismatch',
        code: 'STUDIO_INSTANCE_MISMATCH',
        expected: {
          studioInstanceId: 'studio-a',
          placeId: '1',
          placeName: 'Project A',
        },
        got: {
          studioInstanceId: 'studio-b',
          placeId: '2',
          placeName: 'Project B',
        },
      });
    });
  });

  describe('Response Handling', () => {
    test('should handle successful response', async () => {
      const requestId = 'test-request-id';
      const responseData = { result: 'success' };

      const requestPromise = bridge.sendRequest('/api/test', {});
      const pendingRequest = bridge.getPendingRequest();

      const response = await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          response: responseData
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      const result = await requestPromise;
      expect(result).toEqual(responseData);
    });

    test('should handle error response', async () => {
      const error = 'Test error message';

      const requestPromise = bridge.sendRequest('/api/test', {});
      requestPromise.catch(() => {});
      const pendingRequest = bridge.getPendingRequest();

      const response = await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          error: error
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      await expect(requestPromise).rejects.toEqual(error);
    });
  });

  describe('Proxy Endpoint', () => {
    test('should require endpoint for proxy requests', async () => {
      const response = await request(app)
        .post('/proxy')
        .send({ data: { test: true } })
        .expect(400);

      expect(response.body).toEqual({ error: 'endpoint is required' });
    });

    test('should forward proxied request through pending queue', async () => {
      const proxyRequest = new Promise<request.Response>((resolve, reject) => {
        request(app)
          .post('/proxy')
          .send({
            endpoint: '/api/proxy-test',
            data: { value: 123 }
          })
          .end((error, response) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(response);
          });
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const pendingRequest = bridge.getPendingRequest();
      expect(pendingRequest).toBeTruthy();
      expect(pendingRequest?.request).toEqual({
        endpoint: '/api/proxy-test',
        data: { value: 123 }
      });

      await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          response: { ok: true }
        })
        .expect(200);

      const response = await proxyRequest;
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ response: { ok: true } });
    });

    test('should keep reporting proxying mode after proxied activity', async () => {
      app.setMCPServerActive(true);

      const proxyRequest = new Promise<request.Response>((resolve, reject) => {
        request(app)
          .post('/proxy')
          .send({
            endpoint: '/api/proxy-test',
            data: { value: 456 }
          })
          .end((error, response) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(response);
          });
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const pendingRequest = bridge.getPendingRequest();
      expect(pendingRequest).toBeTruthy();

      await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          response: { ok: true }
        })
        .expect(200);

      await proxyRequest;

      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + 60000);

      const pollResponse = await request(app)
        .get('/poll')
        .expect(503);
      expect(pollResponse.body.connectionMode).toBe('proxying');

      const statusResponse = await request(app)
        .get('/status')
        .expect(200);
      expect(statusResponse.body.connectionMode).toBe('proxying');

      Date.now = originalDateNow;
    });

    test('should report active proxied instance count', async () => {
      app.setMCPServerActive(true);

      const sendProxiedRequest = async (proxyInstanceId: string) => {
        const proxyRequest = new Promise<request.Response>((resolve, reject) => {
          request(app)
            .post('/proxy')
            .send({
              endpoint: '/api/proxy-count-test',
              data: { value: proxyInstanceId },
              proxyInstanceId
            })
            .end((error, response) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(response);
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        const pendingRequest = bridge.getPendingRequest();
        expect(pendingRequest).toBeTruthy();

        await request(app)
          .post('/response')
          .send({
            requestId: pendingRequest!.requestId,
            response: { ok: true }
          })
          .expect(200);

        await proxyRequest;
      };

      await sendProxiedRequest('proxy-a');

      const firstStatus = await request(app)
        .get('/status')
        .expect(200);
      expect(firstStatus.body.connectionMode).toBe('proxying');
      expect(firstStatus.body.proxyInstanceCount).toBe(1);

      await sendProxiedRequest('proxy-b');

      const secondPoll = await request(app)
        .get('/poll')
        .expect(200);
      expect(secondPoll.body.connectionMode).toBe('proxying');
      expect(secondPoll.body.proxyInstanceCount).toBe(2);
    });
  });

  describe('MCP Route Forwarding', () => {
    test('should forward start and end lines for get_script_source', async () => {
      const getScriptSourceSpy = jest
        .spyOn(tools, 'getScriptSource')
        .mockResolvedValue({ content: [{ type: 'text', text: '{}' }] } as any);

      await request(app)
        .post('/mcp/get_script_source')
        .send({
          instancePath: 'game.ServerScriptService.MainScript',
          startLine: 10,
          endLine: 25
        })
        .expect(200);

      expect(getScriptSourceSpy).toHaveBeenCalledWith(
        'game.ServerScriptService.MainScript',
        10,
        25
      );
    });
  });

  describe('MCP Server State Management', () => {
    test('should track MCP server activity', async () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);

      app.trackMCPActivity();

      expect(app.isMCPServerActive()).toBe(true);
    });

    test('should timeout MCP server after inactivity', async () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);

      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + 16000);

      expect(app.isMCPServerActive()).toBe(false);

      Date.now = originalDateNow;
    });
  });

  describe('Status Endpoint', () => {
    test('should return current status', async () => {

      await request(app).post('/ready').expect(200);
      app.setMCPServerActive(true);

      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toMatchObject({
        pluginConnected: true,
        mcpServerActive: true
      });
      expect(response.body.lastMCPActivity).toBeGreaterThan(0);
      expect(response.body.uptime).toBeGreaterThan(0);
    });
  });
});
