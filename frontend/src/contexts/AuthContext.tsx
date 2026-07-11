import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PlatformClient, type PlatformUser } from '../services/platformClient.js';

interface AuthContextValue {
  user: PlatformUser | null;
  setUser: (user: PlatformUser | null) => void;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const client = new PlatformClient();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void client.me()
      .then(({ user: next }) => { if (!cancelled) setUser(next); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const logout = useCallback(async () => {
    await client.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, logout }), [user, loading, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
