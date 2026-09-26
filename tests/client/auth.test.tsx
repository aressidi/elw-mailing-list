import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  getToken, setToken, clearToken, isAuthenticated, useIsAuthenticated,
} from '../../client/src/lib/auth.ts';

describe('client auth token storage', () => {
  it('is unauthenticated with no stored token', () => {
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('persists a token across reads and clears it on logout', () => {
    setToken('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
    expect(isAuthenticated()).toBe(true);
    clearToken();
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('re-renders subscribers when the user logs in and out', () => {
    const { result } = renderHook(() => useIsAuthenticated());
    expect(result.current).toBe(false);
    act(() => setToken('t'));
    expect(result.current).toBe(true);
    act(() => clearToken());
    expect(result.current).toBe(false);
  });

  it('reacts to a login performed in another tab (storage event)', () => {
    const { result } = renderHook(() => useIsAuthenticated());
    act(() => {
      localStorage.setItem('elw_auth_token', 'from-other-tab');
      window.dispatchEvent(new StorageEvent('storage', { key: 'elw_auth_token' }));
    });
    expect(result.current).toBe(true);
  });
});
