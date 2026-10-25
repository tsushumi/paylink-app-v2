import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../socket';
import { api } from '../api';

const NotificationContext = createContext(null);
const TOAST_MS = 6000;

export function NotificationProvider({ userId, children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);
  // Bumps whenever a payment notification arrives, so the dashboard knows to refresh its numbers.
  const [paymentTick, setPaymentTick] = useState(0);
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api('/notifications', { userId });
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error('Failed to load notifications', err);
    }
  }, [userId]);

  useEffect(() => {
    load();

    const onNotification = (n) => {
      // Ignore duplicates (e.g. an event racing with the initial load).
      setNotifications((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list].slice(0, 30)));
      setUnreadCount((c) => c + 1);
      setToasts((t) => [...t, n].slice(-4));
      timers.current.set(n.id, setTimeout(() => dismissToast(n.id), TOAST_MS));
      if (n.type === 'payment_received' || n.type === 'payment_failed') setPaymentTick((x) => x + 1);
    };

    // 'connect' fires on first connect AND every reconnect, so registration (and a catch-up load of
    // anything missed while offline) happens each time without stacking duplicate listeners.
    const onConnect = () => {
      setConnected(true);
      socket.emit('register-merchant', userId);
      load();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('notification', onNotification);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.connect();

    const pending = timers.current;
    return () => {
      socket.off('notification', onNotification);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [userId, load, dismissToast]);

  const markRead = useCallback(
    async (id) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.read) return;
      // Optimistic update, rolled back if the request fails.
      setNotifications((l) => l.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await api(`/notifications/${id}/read`, { method: 'POST', userId });
      } catch {
        load();
      }
    },
    [notifications, userId, load]
  );

  const markAllRead = useCallback(async () => {
    setNotifications((l) => l.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api('/notifications/read-all', { method: 'POST', userId });
    } catch {
      load();
    }
  }, [userId, load]);

  const value = useMemo(
    () => ({ notifications, unreadCount, toasts, connected, paymentTick, markRead, markAllRead, dismissToast }),
    [notifications, unreadCount, toasts, connected, paymentTick, markRead, markAllRead, dismissToast]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}
