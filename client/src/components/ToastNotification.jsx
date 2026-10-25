import { useNotifications } from '../context/NotificationContext';

export default function ToastNotification() {
  const { toasts, dismissToast } = useNotifications();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type === 'payment_failed' ? 'toast-bad' : 'toast-good'}`} role="status">
          <div>
            <strong>{t.title}</strong>
            <p>{t.message}</p>
          </div>
          <button className="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
