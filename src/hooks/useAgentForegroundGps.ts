import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAuthToken } from '../lib/api';
import type { Agent, ForegroundSyncMode, LocationPermissionMode, Order } from '../types';

const GPS_QUEUE_STORAGE_KEY = 'shine_agent_gps_offline_queue';
const SYNC_INTERVAL_MS = 6000; // Intervalle régulier 6s (dans la plage 5-10s demandée)
const MAX_RETRY_MS = 6000;

export type GpsConnectionState = 'connected' | 'reconnecting' | 'offline';

interface QueuedGpsTick {
  orderId: string;
  agentId: string;
  lat: number;
  lng: number;
  accuracyMeters?: number;
  speedKmh?: number;
  backgroundMode: ForegroundSyncMode;
  permissionMode: LocationPermissionMode;
  capturedAt: string;
}

interface NativeBgGeolocationBridge {
  ready?: (config: Record<string, unknown>, cb?: () => void) => void;
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
  requestPermission?: () => Promise<number>;
}

interface NetworkInformationLike {
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

declare global {
  interface Window {
    BackgroundGeolocation?: NativeBgGeolocationBridge;
  }
}

interface UseAgentForegroundGpsOptions {
  agent: Agent | undefined;
  activeEnRouteOrder: Order | undefined;
  activeMissionOrder: Order | undefined;
  onSynced: () => void;
}

export function useAgentForegroundGps({
  agent,
  activeEnRouteOrder,
  activeMissionOrder,
  onSynced,
}: UseAgentForegroundGpsOptions) {
  const [browserGeoState, setBrowserGeoState] = useState<'granted' | 'prompt' | 'denied' | 'unsupported'>('prompt');
  const [notificationState, setNotificationState] = useState<'granted' | 'default' | 'denied' | 'unsupported'>('default');
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [swNotificationActive, setSwNotificationActive] = useState(false);
  const [nativeBridgeActive, setNativeBridgeActive] = useState(false);
  const [syncMode, setSyncMode] = useState<ForegroundSyncMode>('idle');
  const [connectionState, setConnectionState] = useState<GpsConnectionState>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connected'
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(agent?.lastGpsSyncAt || null);
  const [syncCount, setSyncCount] = useState(0);
  const [queuedOfflineCount, setQueuedOfflineCount] = useState(0);
  const [lastAccuracyMeters, setLastAccuracyMeters] = useState<number | null>(
    agent?.gpsAccuracyMeters ?? null
  );
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionFeedback, setPermissionFeedback] = useState<string | null>(null);

  const latestCoordsRef = useRef<{
    lat: number;
    lng: number;
    accuracyMeters?: number;
    speedKmh?: number;
  } | null>(agent ? { lat: agent.currentLocation.lat, lng: agent.currentLocation.lng } : null);

  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryStepRef = useRef(0);
  const fallbackNotificationRef = useRef<Notification | null>(null);

  const effectivePermissionMode: LocationPermissionMode =
    browserGeoState === 'denied'
      ? 'denied'
      : agent?.locationPermissionMode === 'always_allow'
      ? 'always_allow'
      : browserGeoState === 'granted'
      ? 'when_in_use'
      : 'prompt';

  // Keep latest coordinates anchored to agent record if no hardware fix received yet
  useEffect(() => {
    if (agent && !latestCoordsRef.current) {
      latestCoordsRef.current = {
        lat: agent.currentLocation.lat,
        lng: agent.currentLocation.lng,
      };
    }
    if (agent?.lastGpsSyncAt) {
      setLastSyncAt((prev) => prev || agent.lastGpsSyncAt || null);
    }
  }, [agent]);

  // Monitor Browser Geolocation & Notification Permissions
  const refreshPermissionStates = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setBrowserGeoState('unsupported');
    } else if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        setBrowserGeoState(status.state);
        status.onchange = () => {
          setBrowserGeoState(status.state);
        };
      } catch {
        setBrowserGeoState('prompt');
      }
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationState('unsupported');
    } else {
      setNotificationState(Notification.permission);
    }

    setNativeBridgeActive(Boolean(typeof window !== 'undefined' && window.BackgroundGeolocation));
  }, []);

  useEffect(() => {
    void refreshPermissionStates();
  }, [refreshPermissionStates]);

  // Read/write offline buffered queue
  const readOfflineQueue = useCallback((): QueuedGpsTick[] => {
    try {
      const raw = localStorage.getItem(GPS_QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const writeOfflineQueue = useCallback((queue: QueuedGpsTick[]) => {
    try {
      if (queue.length === 0) {
        localStorage.removeItem(GPS_QUEUE_STORAGE_KEY);
      } else {
        localStorage.setItem(GPS_QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-50)));
      }
      setQueuedOfflineCount(Math.min(50, queue.length));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    setQueuedOfflineCount(readOfflineQueue().length);
  }, [readOfflineQueue]);

  // Persistent Foreground Service Notification + Screen WakeLock while mission is active
  const missionRequiresForegroundGps = Boolean(
    agent && (activeEnRouteOrder || (activeMissionOrder && ['en_route', 'arrived', 'in_progress'].includes(activeMissionOrder.status)))
  );

  const showForegroundServiceNotification = useCallback(async (orderRef?: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setSwNotificationActive(false);
      return;
    }

    if (Notification.permission !== 'granted') {
      setNotificationState(Notification.permission);
      setSwNotificationActive(false);
      return;
    }

    const title = 'Shine x Sanitize : Suivi GPS actif pour la mission en cours';
    const body = orderRef
      ? `Mission ${orderRef} : synchronisation temps réel active même écran verrouillé ou application minimisée.`
      : 'Partage GPS en arrière-plan actif dans Libreville, Akanda & Owendo.';

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/notification-icon-96x96.png',
          tag: 'shine-agent-gps-foreground',
          silent: true,
          requireInteraction: true,
        });
        setSwNotificationActive(true);
        return;
      } catch {
        // Fall through to standard Notification API
      }
    }

    try {
      fallbackNotificationRef.current?.close();
      fallbackNotificationRef.current = new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        tag: 'shine-agent-gps-foreground',
        silent: true,
        requireInteraction: true,
      });
      setSwNotificationActive(true);
    } catch {
      setSwNotificationActive(false);
    }
  }, []);

  const clearForegroundServiceNotification = useCallback(async () => {
    setSwNotificationActive(false);
    try {
      fallbackNotificationRef.current?.close();
      fallbackNotificationRef.current = null;
    } catch {
      // ignore
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const notifications = await reg.getNotifications({ tag: 'shine-agent-gps-foreground' });
      notifications.forEach((n) => n.close());
    } catch {
      // ignore
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockActive(false);
      return;
    }
    if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
      setWakeLockActive(true);
      return;
    }
    try {
      const navWithWakeLock = navigator as Navigator & {
        wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      const sentinel = await navWithWakeLock.wakeLock.request('screen');
      wakeLockSentinelRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener?.('release', () => {
        if (wakeLockSentinelRef.current === sentinel) {
          wakeLockSentinelRef.current = null;
        }
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockSentinelRef.current) {
      try {
        await wakeLockSentinelRef.current.release();
      } catch {
        // ignore
      }
      wakeLockSentinelRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  // Force « Toujours autoriser » (Always Allow) permission + Persistent Notification activation
  const requestAlwaysAllowPermission = useCallback(async () => {
    if (!agent) return false;
    setPermissionBusy(true);
    setPermissionFeedback(null);

    try {
      if (typeof window !== 'undefined' && window.BackgroundGeolocation?.requestPermission) {
        try {
          await window.BackgroundGeolocation.requestPermission();
          setNativeBridgeActive(true);
        } catch {
          // continue with web permissions
        }
      }

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try {
          const nPerm = await Notification.requestPermission();
          setNotificationState(nPerm);
        } catch {
          // non-blocking
        }
      }

      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        setPermissionFeedback('Géolocalisation indisponible sur cet appareil.');
        return false;
      }

      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      latestCoordsRef.current = {
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        accuracyMeters: Math.round(pos.coords.accuracy),
        speedKmh: pos.coords.speed ? Number((pos.coords.speed * 3.6).toFixed(1)) : undefined,
      };
      setLastAccuracyMeters(Math.round(pos.coords.accuracy));
      setBrowserGeoState('granted');

      await api.updateAgentLocationPermission(agent.id, 'always_allow');
      onSynced();
      setPermissionFeedback(
        'Permission « Toujours autoriser » validée et Service GPS permanent prêt (notification persistante & reconnexion auto).'
      );
      return true;
    } catch {
      setBrowserGeoState('denied');
      if (agent) {
        void api.updateAgentLocationPermission(agent.id, 'denied').catch(() => {});
      }
      setPermissionFeedback(
        'Autorisation refusée : ouvrez les réglages de l’appareil et choisissez Localisation → « Toujours autoriser ».'
      );
      return false;
    } finally {
      setPermissionBusy(false);
    }
  }, [agent, onSynced]);

  // Core Infinite Background Geolocation Engine + Offline Queue + Auto-Reconnect
  useEffect(() => {
    if (!agent || !missionRequiresForegroundGps) {
      setSyncMode('idle');
      retryStepRef.current = 0;
      setReconnectAttempt(0);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      void releaseWakeLock();
      void clearForegroundServiceNotification();
      if (typeof window !== 'undefined' && window.BackgroundGeolocation?.stop) {
        try {
          void window.BackgroundGeolocation.stop();
        } catch {
          // ignore
        }
      }
      return;
    }

    let cancelled = false;
    let watchId: number | null = null;
    let flushing = false;
    const targetOrder = activeEnRouteOrder || activeMissionOrder;

    const resolveSyncMode = (): ForegroundSyncMode =>
      typeof window !== 'undefined' && window.BackgroundGeolocation
        ? 'native_bridge'
        : document.visibilityState === 'hidden'
        ? 'visibility_heartbeat'
        : 'foreground_sw_wakelock';

    setSyncMode(resolveSyncMode());

    // Start native BackgroundGeolocation bridge when inside Android/iOS wrapper
    if (typeof window !== 'undefined' && window.BackgroundGeolocation) {
      try {
        window.BackgroundGeolocation.ready?.({
          desiredAccuracy: 0,
          distanceFilter: 0,
          heartbeatInterval: 6,
          preventSuspend: true,
          stopOnTerminate: false,
          startOnBoot: true,
          foregroundService: true,
          autoSync: true,
          batchSync: true,
          locationAuthorizationRequest: 'Always',
        });
        void window.BackgroundGeolocation.start?.();
      } catch {
        // fallback to Web Foreground Service engine below
      }
    }

    void acquireWakeLock();
    void showForegroundServiceNotification(targetOrder?.referenceCode);

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          latestCoordsRef.current = {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracyMeters: Math.round(pos.coords.accuracy),
            speedKmh: pos.coords.speed ? Number((pos.coords.speed * 3.6).toFixed(1)) : undefined,
          };
          setLastAccuracyMeters(Math.round(pos.coords.accuracy));
          setBrowserGeoState('granted');
        },
        () => {
          // Keep last known coordinates & heartbeat running so service never stalls
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );
    }

    const scheduleFastReconnect = () => {
      if (cancelled || reconnectTimerRef.current) return;
      retryStepRef.current = Math.min(4, retryStepRef.current + 1);
      setReconnectAttempt(retryStepRef.current);
      const delayMs = Math.min(MAX_RETRY_MS, 1500 * Math.pow(2, retryStepRef.current - 1));
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void flushAndPushTick(false);
      }, delayMs);
    };

    const flushAndPushTick = async (useKeepalive = false) => {
      if (cancelled || !agent || flushing) return;
      flushing = true;

      try {
        const coords = latestCoordsRef.current || {
          lat: agent.currentLocation.lat,
          lng: agent.currentLocation.lng,
        };
        const modeNow = resolveSyncMode();
        setSyncMode(modeNow);

        const capturedAt = new Date().toISOString();
        const payload = {
          lat: coords.lat,
          lng: coords.lng,
          accuracyMeters: coords.accuracyMeters,
          speedKmh: coords.speedKmh,
          backgroundMode: modeNow,
          permissionMode: effectivePermissionMode,
          orderId: targetOrder?.id,
          capturedAt,
        };

        if (useKeepalive && typeof fetch === 'function') {
          const token = getAuthToken();
          const url =
            activeEnRouteOrder && activeEnRouteOrder.gpsActive
              ? `/api/orders/${activeEnRouteOrder.id}/gps`
              : `/api/agents/${agent.id}/gps-heartbeat`;
          try {
            void fetch(url, {
              method: 'POST',
              keepalive: true,
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ ...payload, source: 'agent_app' }),
            });
          } catch {
            // ignore keepalive failure
          }
          return;
        }

        // Flush any buffered offline coordinates chronologically before sending current fix
        const queue = readOfflineQueue();
        if (queue.length > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
          const remaining: QueuedGpsTick[] = [];
          let hitNetworkError = false;
          for (const item of queue) {
            if (hitNetworkError) {
              remaining.push(item);
              continue;
            }
            try {
              if (item.orderId && activeEnRouteOrder?.id === item.orderId && activeEnRouteOrder.gpsActive) {
                await api.updateGps(item.orderId, {
                  lat: item.lat,
                  lng: item.lng,
                  accuracyMeters: item.accuracyMeters,
                  speedKmh: item.speedKmh,
                  backgroundMode: item.backgroundMode,
                  permissionMode: item.permissionMode,
                  capturedAt: item.capturedAt,
                  source: 'agent_app',
                });
              } else {
                await api.sendAgentGpsHeartbeat(item.agentId, item);
              }
            } catch {
              hitNetworkError = true;
              remaining.push(item);
            }
          }
          writeOfflineQueue(remaining);
        }

        try {
          if (activeEnRouteOrder && activeEnRouteOrder.gpsActive) {
            await api.updateGps(activeEnRouteOrder.id, {
              ...payload,
              source: 'agent_app',
            });
          } else {
            await api.sendAgentGpsHeartbeat(agent.id, payload);
          }

          if (!cancelled) {
            retryStepRef.current = 0;
            setReconnectAttempt(0);
            setConnectionState('connected');
            setLastSyncAt(capturedAt);
            setSyncCount((c) => c + 1);
            onSynced();
          }
        } catch {
          if (!cancelled) {
            setConnectionState(
              typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting'
            );
          }
          const nextQ = readOfflineQueue();
          nextQ.push({
            orderId: targetOrder?.id || '',
            agentId: agent.id,
            lat: coords.lat,
            lng: coords.lng,
            accuracyMeters: coords.accuracyMeters,
            speedKmh: coords.speedKmh,
            backgroundMode: modeNow,
            permissionMode: effectivePermissionMode,
            capturedAt,
          });
          writeOfflineQueue(nextQ);
          scheduleFastReconnect();
        }
      } finally {
        flushing = false;
      }
    };

    // Immediate initial sync on mission activation
    void flushAndPushTick(false);

    // Fixed 6-second interval synchronization to database
    const intervalId = window.setInterval(() => {
      void flushAndPushTick(false);
    }, SYNC_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setSyncMode(resolveSyncMode());
        void acquireWakeLock();
        void showForegroundServiceNotification(targetOrder?.referenceCode);
        void flushAndPushTick(false);
      } else {
        setSyncMode(resolveSyncMode());
        void flushAndPushTick(true);
      }
    };

    const handleFocus = () => {
      void acquireWakeLock();
      void flushAndPushTick(false);
    };

    const handlePageHide = () => {
      void flushAndPushTick(true);
    };

    const handleOffline = () => {
      setConnectionState('offline');
    };

    const handleOnline = () => {
      setConnectionState('reconnecting');
      retryStepRef.current = 0;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      void flushAndPushTick(false);
    };

    const netConn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    netConn?.addEventListener?.('change', handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      netConn?.removeEventListener?.('change', handleOnline);
      if (watchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [
    agent?.id,
    missionRequiresForegroundGps,
    activeEnRouteOrder?.id,
    activeEnRouteOrder?.gpsActive,
    activeMissionOrder?.id,
    activeMissionOrder?.status,
    effectivePermissionMode,
    nativeBridgeActive,
    acquireWakeLock,
    releaseWakeLock,
    showForegroundServiceNotification,
    clearForegroundServiceNotification,
    readOfflineQueue,
    writeOfflineQueue,
    onSynced,
  ]);

  return {
    browserGeoState,
    notificationState,
    effectivePermissionMode,
    wakeLockActive,
    swNotificationActive,
    nativeBridgeActive,
    syncMode,
    connectionState,
    reconnectAttempt,
    lastSyncAt,
    syncCount,
    queuedOfflineCount,
    lastAccuracyMeters,
    syncIntervalSeconds: SYNC_INTERVAL_MS / 1000,
    permissionBusy,
    permissionFeedback,
    requestAlwaysAllowPermission,
  };
}
