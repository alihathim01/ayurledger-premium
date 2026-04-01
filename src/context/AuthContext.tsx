import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { tokenStore, withApiBase } from '../api';

export type UserRole =
  | 'admin'
  | 'accountant'
  | 'auditor'
  | 'warehouse_manager'
  | 'store_manager'
  | 'cashier'
  | 'massage_manager';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwtPayload(token: string): (AuthUser & { exp?: number }) | null {
  try {
    const [, payloadB64] = token.split('.');
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { sub: number; username: string; role: UserRole; exp?: number };
    return { id: payload.sub, username: payload.username, role: payload.role, exp: payload.exp };
  } catch {
    return null;
  }
}

function isTokenValid(token: string) {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.exp && payload.exp > Math.floor(Date.now() / 1000));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyToken = useCallback((rawToken: string) => {
    const payload = decodeJwtPayload(rawToken);
    if (!payload) {
      return;
    }
    tokenStore.set(rawToken);
    setToken(rawToken);
    setUser({ id: payload.id, username: payload.username, role: payload.role });
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const stored = tokenStore.get();
    if (stored && isTokenValid(stored)) {
      applyToken(stored);
    } else {
      tokenStore.clear();
    }
    setIsLoading(false);
  }, [applyToken]);

  useEffect(() => {
    window.addEventListener('ayurledger:logout', logout);
    return () => window.removeEventListener('ayurledger:logout', logout);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(withApiBase('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      let message = 'Login failed';
      try {
        const err = await res.json();
        message = err.error ?? message;
      } catch {}
      throw new Error(message);
    }

    const data = (await res.json()) as { token: string; user: AuthUser };
    applyToken(data.token);
  }, [applyToken]);

  const hasRole = useCallback(
    (roles: UserRole[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
