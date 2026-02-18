import { ProxyBridgeService } from '../proxy-bridge-service.js';

describe('ProxyBridgeService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns response payload from proxy endpoint', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { ok: true } }),
    })) as unknown as typeof fetch;

    const bridge = new ProxyBridgeService('http://127.0.0.1:58741');
    await expect(bridge.sendRequest('/api/test', { value: 1 })).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchOptions = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(String(fetchOptions.body));
    expect(requestBody.endpoint).toBe('/api/test');
    expect(requestBody.data).toEqual({ value: 1 });
    expect(typeof requestBody.proxyInstanceId).toBe('string');
    expect(requestBody.proxyInstanceId.length).toBeGreaterThan(0);
  });

  test('maps aborts to Request timeout', async () => {
    global.fetch = jest.fn(async () => {
      const abortError = new Error('aborted');
      (abortError as Error & { name: string }).name = 'AbortError';
      throw abortError;
    }) as unknown as typeof fetch;

    const bridge = new ProxyBridgeService('http://127.0.0.1:58741');
    await expect(bridge.sendRequest('/api/test', {})).rejects.toThrow('Request timeout');
  });

  test('propagates proxy errors from response body', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'primary unavailable' }),
    })) as unknown as typeof fetch;

    const bridge = new ProxyBridgeService('http://127.0.0.1:58741');
    await expect(bridge.sendRequest('/api/test', {})).rejects.toThrow('Proxy request failed: primary unavailable');
  });
});
