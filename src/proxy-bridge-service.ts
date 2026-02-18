import { BridgeService } from './bridge-service.js';

interface ProxyResponseBody {
  response?: unknown;
  error?: unknown;
}

export class ProxyBridgeService extends BridgeService {
  private readonly proxyUrl: string;
  private readonly proxyRequestTimeout: number;

  constructor(baseUrl: string, requestTimeout: number = 30000) {
    super();
    this.proxyUrl = `${baseUrl.replace(/\/+$/, '')}/proxy`;
    this.proxyRequestTimeout = requestTimeout;
  }

  override async sendRequest(endpoint: string, data: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.proxyRequestTimeout);

    try {
      const response = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint, data }),
        signal: controller.signal,
      });

      let payload: ProxyResponseBody = {};
      try {
        payload = await response.json() as ProxyResponseBody;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const errorMessage = payload.error ? String(payload.error) : `Proxy request failed with status ${response.status}`;
        throw new Error(errorMessage);
      }

      if (payload.error !== undefined) {
        throw new Error(String(payload.error));
      }

      return payload.response;
    } catch (error) {
      const isAbortError = typeof error === 'object'
        && error !== null
        && 'name' in error
        && (error as { name: string }).name === 'AbortError';

      if (isAbortError) {
        throw new Error('Request timeout');
      }

      if (error instanceof Error) {
        if (error.message === 'Request timeout') {
          throw error;
        }
        throw new Error(`Proxy request failed: ${error.message}`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  override cleanupOldRequests() {
    return;
  }

  override clearAllPendingRequests() {
    return;
  }
}
