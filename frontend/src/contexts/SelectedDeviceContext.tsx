import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Device } from '../services/api.js';
import * as deviceClient from '../services/deviceClient.js';

const STORAGE_KEY = 'patrol:selectedDeviceId';

interface SelectedDeviceContextValue {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  devices: Device[];
  selectedDevice: Device | null;
  refreshDevices: (q?: string) => Promise<Device[]>;
  loading: boolean;
  error: string | null;
}

const SelectedDeviceContext = createContext<SelectedDeviceContextValue | null>(null);

export function SelectedDeviceProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedIdState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshDevices = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const next = await deviceClient.devices(q);
      setDevices(next);
      setError(null);
      setSelectedIdState((current) => {
        const preferred = current ?? localStorage.getItem(STORAGE_KEY);
        if (preferred && next.some((device) => device.id === preferred)) return preferred;
        // Keep selection when a search temporarily hides the current device.
        if (q?.trim() && preferred) return preferred;
        if (next[0]) {
          localStorage.setItem(STORAGE_KEY, next[0].id);
          return next[0].id;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
      });
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载设备失败');
      setDevices([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedId) ?? null,
    [devices, selectedId],
  );

  const value = useMemo(
    () => ({ selectedId, setSelectedId, devices, selectedDevice, refreshDevices, loading, error }),
    [selectedId, setSelectedId, devices, selectedDevice, refreshDevices, loading, error],
  );

  return <SelectedDeviceContext.Provider value={value}>{children}</SelectedDeviceContext.Provider>;
}

export function useSelectedDevice(): SelectedDeviceContextValue {
  const ctx = useContext(SelectedDeviceContext);
  if (!ctx) throw new Error('useSelectedDevice must be used within SelectedDeviceProvider');
  return ctx;
}
