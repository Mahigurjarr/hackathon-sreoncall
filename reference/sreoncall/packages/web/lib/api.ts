import { auth } from '@/lib/auth';
import { signOut } from 'next-auth/react';

export class APIError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: Record<string, unknown>,
  ) {
    // Read whichever field the backend actually used — RFC 7807-style
    // `detail`, legacy `error`, generic `message`, or a plain string body.
    const fromBody =
      (typeof body?.detail === 'string' && body.detail) ||
      (typeof body?.error === 'string' && body.error) ||
      (typeof body?.message === 'string' && body.message) ||
      '';
    super(fromBody || `API Error: ${status} ${statusText}`);
    this.name = 'APIError';
  }

  /** Returns true if this error is a plan limit / feature gate response (HTTP 402) */
  isPlanLimitError(): boolean {
    return (
      this.status === 402 &&
      this.body?.type === 'https://sreoncall.io/problems/plan-limit-reached'
    );
  }

  get planLimitKey(): string | undefined {
    return this.body?.limit_key as string | undefined;
  }

  get planName(): string | undefined {
    return this.body?.plan as string | undefined;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
};

function isServer(): boolean {
  return typeof window === 'undefined';
}

function getBaseURL(): string {
  if (isServer()) {
    return process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';
  }
  return '';
}

async function getSessionData(): Promise<{ token?: string; tenantSlug: string }> {
  if (isServer()) {
    const session = await auth();
    return {
      token: session?.accessToken,
      tenantSlug: (session as any)?.tenantSlug || 'platform',
    };
  }
  try {
    const res = await fetch('/api/auth/session');
    const session = await res.json();
    return {
      token: session?.accessToken,
      tenantSlug: session?.tenantSlug || 'platform',
    };
  } catch {
    return { tenantSlug: 'platform' };
  }
}

class APIClient {
  private baseURL: string;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || getBaseURL();
  }

  private buildURL(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    const url = new URL(`${this.baseURL}${path}`, isServer() ? this.baseURL : window.location.origin);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, params, headers: customHeaders, ...init } = options;

    const { token, tenantSlug } = await getSessionData();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenantSlug,
      ...Object.fromEntries(
        Object.entries(customHeaders || {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = this.buildURL(path, params);

    const res = await fetch(url, {
      ...init,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      if (res.status === 401 && !isServer()) {
        // Use NextAuth signOut to clear the session cookie before redirecting.
        // Without this, the middleware sees the stale cookie and redirects
        // /signin back to /dashboard, causing an infinite refresh loop.
        signOut({ callbackUrl: `${window.location.origin}/signin` });
        // Return a never-resolving promise so callers don't process stale data
        return new Promise<T>(() => {});
      }
      const errorBody = await res.json().catch(() => ({}));
      throw new APIError(res.status, res.statusText, errorBody);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new APIClient();
export default APIClient;
