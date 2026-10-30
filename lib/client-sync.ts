'use client';

import { useEffect, useRef } from 'react';

export type SyncEventType = 'MENU_UPDATED' | 'ORDERS_UPDATED' | 'TEACHER_ORDERS_UPDATED';

const CHANNEL_NAME = 'schoolbite_live_sync';
const STORAGE_KEY = 'schoolbite_sync_event';
// Identifies this tab, so its own cross-tab messages are not handled a second time (the
// same-window CustomEvent already delivered them).
const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
// Events of one type arriving within this window (BroadcastChannel + storage fallback, or several
// quick handovers) trigger a single refresh.
const COALESCE_MS = 800;

/**
 * Broadcast an event locally across all open tabs/windows in the browser immediately (0ms latency).
 */
export function broadcastSyncEvent(type: SyncEventType) {
  if (typeof window === 'undefined') return;

  const payload = { type, timestamp: Date.now(), source: TAB_ID };

  // 1. Same-window CustomEvent
  window.dispatchEvent(new CustomEvent('schoolbite_sync', { detail: payload }));

  // 2. Cross-tab BroadcastChannel
  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // ignore
  }

  // 3. Cross-tab localStorage event fallback
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

interface UseSyncWatcherOptions {
  onMenuUpdate?: () => void;
  onOrdersUpdate?: () => void;
  onTeacherOrdersUpdate?: () => void;
  pollIntervalMs?: number;
  enabled?: boolean;
}

/**
 * React hook that listens for real-time changes across the application without requiring page refresh.
 * Combines BroadcastChannel (instant in same browser) with lightweight server version polling (cross-device).
 */
export function useSyncWatcher({
  onMenuUpdate,
  onOrdersUpdate,
  onTeacherOrdersUpdate,
  pollIntervalMs = 10000,
  enabled = true,
}: UseSyncWatcherOptions) {
  const lastVersionsRef = useRef<{
    menuVersion?: number;
    ordersVersion?: number;
    teacherOrdersVersion?: number;
    isInitialized: boolean;
  }>({ isInitialized: false });

  const callbacksRef = useRef({ onMenuUpdate, onOrdersUpdate, onTeacherOrdersUpdate });
  useEffect(() => {
    callbacksRef.current = { onMenuUpdate, onOrdersUpdate, onTeacherOrdersUpdate };
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // Runs each callback at most once per burst of events of the same type.
    const pending = new Map<SyncEventType, ReturnType<typeof setTimeout>>();
    const dispatch = (type: unknown, source?: unknown) => {
      if (source === TAB_ID) return;
      if (type !== 'MENU_UPDATED' && type !== 'ORDERS_UPDATED' && type !== 'TEACHER_ORDERS_UPDATED') return;
      if (pending.has(type)) return;
      pending.set(
        type,
        setTimeout(() => {
          pending.delete(type);
          if (type === 'MENU_UPDATED') callbacksRef.current.onMenuUpdate?.();
          else if (type === 'ORDERS_UPDATED') callbacksRef.current.onOrdersUpdate?.();
          else callbacksRef.current.onTeacherOrdersUpdate?.();
        }, COALESCE_MS)
      );
    };

    // 1. Function to check server versions
    let isFetching = false;
    const checkServerVersions = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const res = await fetch('/api/sync/events', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        const prev = lastVersionsRef.current;
        if (!prev.isInitialized) {
          prev.menuVersion = data.menuVersion;
          prev.ordersVersion = data.ordersVersion;
          prev.teacherOrdersVersion = data.teacherOrdersVersion;
          prev.isInitialized = true;
          return;
        }

        if (data.menuVersion && data.menuVersion > (prev.menuVersion ?? 0)) {
          prev.menuVersion = data.menuVersion;
          dispatch('MENU_UPDATED');
        }

        if (data.ordersVersion && data.ordersVersion > (prev.ordersVersion ?? 0)) {
          prev.ordersVersion = data.ordersVersion;
          dispatch('ORDERS_UPDATED');
        }

        if (data.teacherOrdersVersion && data.teacherOrdersVersion > (prev.teacherOrdersVersion ?? 0)) {
          prev.teacherOrdersVersion = data.teacherOrdersVersion;
          dispatch('TEACHER_ORDERS_UPDATED');
        }
      } catch (err) {
        // network hiccups ignored during background sync
      } finally {
        isFetching = false;
      }
    };

    // Initial check
    checkServerVersions();

    // 2. BroadcastChannel listener (Instant 0ms across tabs in same browser)
    let channel: BroadcastChannel | null = null;
    try {
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event) => {
          const { type, source } = event.data || {};
          dispatch(type, source);
        };
      }
    } catch {
      // ignore
    }

    // 3. Local CustomEvent listener (Same tab)
    const handleCustomEvent = (e: Event) => {
      const customEvt = e as CustomEvent;
      const { type } = customEvt.detail || {};
      dispatch(type);
    };
    window.addEventListener('schoolbite_sync', handleCustomEvent);

    // 4. LocalStorage event listener (Fallback for cross-tab in older browsers)
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const { type, source } = JSON.parse(e.newValue);
          dispatch(type, source);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    // 5. Visibility and Focus listeners (Immediate check when user returns to tab)
    const handleFocus = () => {
      checkServerVersions();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    // 6. Adaptive periodic poll (Fast when tab active, slower when backgrounded)
    const intervalId = setInterval(() => {
      if (document.hidden) {
        // In background: poll only occasionally (e.g. 15s)
        return;
      }
      checkServerVersions();
    }, pollIntervalMs);

    return () => {
      clearInterval(intervalId);
      pending.forEach((timer) => clearTimeout(timer));
      if (channel) channel.close();
      window.removeEventListener('schoolbite_sync', handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [enabled, pollIntervalMs]);
}
