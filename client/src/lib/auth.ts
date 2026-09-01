import { useSyncExternalStore } from 'react';

const TOKEN_KEY = 'elw_auth_token';
const AUTH_CHANGE_EVENT = 'elw-auth-change';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(AUTH_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(AUTH_CHANGE_EVENT, callback);
  };
}

// Reactive wrapper around isAuthenticated() so components re-render when the
// token changes (via login/logout in this tab, or another tab via 'storage').
export function useIsAuthenticated(): boolean {
  return useSyncExternalStore(subscribe, isAuthenticated);
}
