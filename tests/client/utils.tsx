import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown } | undefined;

/**
 * Replaces global fetch with a mock that routes by pathname. Each handler
 * receives the parsed URL (relative URLs resolve against http://localhost)
 * and returns { status, body }. Unrouted requests answer 404.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = routes[url.pathname];
    const result = handler?.(url, init) ?? { status: 404, body: { success: false, error: 'not mocked' } };
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** The request URLs (path + query) fetch was called with. */
export function requestedUrls(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

export function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}
