import { useCallback, useEffect, useState } from 'react';
import { NotificationProvider, useNotifications } from '../context/NotificationContext';
import NotificationBell from '../components/NotificationBell';
import ToastNotification from '../components/ToastNotification';
import { api, kes } from '../api';

function Stat({ label, value }) {
  return (
    <div className="card stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );
}

function Chart({ data }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const hasData = data.some((d) => d.total > 0);
  return (
    <div className="card">
      <h3>Payments - last 7 days</h3>
      {!hasData && <p className="muted small">No completed payments in the last 7 days yet.</p>}
      <div className="chart" role="img" aria-label="Bar chart of daily payment totals for the last 7 days">
        {data.map((day) => (
          <div className="col" key={day.date} title={`${day.date}: ${kes(day.total)} (${day.count} payment${day.count === 1 ? '' : 's'})`}>
            <span className="bar-value">{day.total > 0 ? (day.total >= 1000 ? `${(day.total / 1000).toFixed(1)}k` : day.total) : ''}</span>
            <div className="bar-wrap">
              <div className="bar" style={{ height: `${(day.total / max) * 100}%`, minHeight: day.total > 0 ? 4 : 0 }} />
            </div>
            <span className="bar-label">{day.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateLink({ userId, onCreated }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/payment-links', { method: 'POST', userId, body: { description, amount: Number(amount) } });
      setDescription('');
      setAmount('');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card inline-form" onSubmit={submit}>
      <h3>New payment link</h3>
      <div className="row">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it for?" maxLength={120} required />
        <input type="number" min="1" max="150000" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (KES)" required />
        <button className="btn primary" disabled={busy}>Create</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link:', text);
    }
  };
  return (
    <button className="btn small" onClick={copy}>
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function DashboardContent({ userId }) {
  const { paymentTick } = useNotifications();
  const [analytics, setAnalytics] = useState(null);
  const [links, setLinks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [a, l, p] = await Promise.all([
        api('/analytics', { userId }),
        api('/payment-links', { userId }),
        api('/payments', { userId }),
      ]);
      setAnalytics(a);
      setLinks(l);
      setPayments(p);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [userId]);

  // Initial load, and again whenever a payment notification arrives (live analytics).
  useEffect(() => {
    loadAll();
  }, [loadAll, paymentTick]);

  if (error) return <p className="error">{error}</p>;
  if (!analytics) return <p className="muted">Loading dashboard...</p>;

  const avg = analytics.totalPayments ? Math.round(analytics.totalReceived / analytics.totalPayments) : 0;

  return (
    <>
      <div className="stats">
        <Stat label="Total received" value={kes(analytics.totalReceived)} />
        <Stat label="Total payments" value={analytics.totalPayments} />
        <Stat label="Average payment" value={kes(avg)} />
      </div>

      <Chart data={analytics.chartData} />

      <CreateLink userId={userId} onCreated={loadAll} />

      <div className="card">
        <h3>Your payment links</h3>
        {links.length === 0 ? (
          <p className="muted small">No links yet. Create one above and share it with a customer.</p>
        ) : (
          <ul className="list">
            {links.map((l) => {
              const url = `${window.location.origin}/pay/${l.id}`;
              return (
                <li key={l.id} className="list-row">
                  <div>
                    <strong>{l.description}</strong>
                    <p className="muted small">{kes(l.amount)} · {l.paidCount} paid</p>
                  </div>
                  <div className="row-actions">
                    <a className="btn small" href={url} target="_blank" rel="noreferrer">Open</a>
                    <CopyButton text={url} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Recent payments</h3>
        {payments.length === 0 ? (
          <p className="muted small">Nothing yet.</p>
        ) : (
          <ul className="list">
            {payments.map((p) => (
              <li key={p.id} className="list-row">
                <div>
                  <strong>{kes(p.amount)}</strong> <span className="muted small">· {p.description}</span>
                  <p className="muted small">
                    {p.phone} · {new Date(p.paidAt || p.createdAt).toLocaleString('en-KE')}
                    {p.mpesaReceiptNumber ? ` · ${p.mpesaReceiptNumber}` : ''}
                  </p>
                </div>
                <span className={`pill ${p.status}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ConnectionDot() {
  const { connected } = useNotifications();
  return (
    <span className={`live ${connected ? 'on' : 'off'}`} title={connected ? 'Live updates on' : 'Reconnecting...'}>
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

export default function Dashboard({ user, onSignOut }) {
  return (
    <NotificationProvider userId={user.id}>
      <div className="page">
        <nav className="navbar">
          <h1 className="logo">PayLink</h1>
          <div className="nav-right">
            <ConnectionDot />
            <NotificationBell />
            <span className="muted small hide-mobile">{user.name}</span>
            <button className="link-btn" onClick={onSignOut}>Sign out</button>
          </div>
        </nav>
        <main className="main">
          <h2>Dashboard</h2>
          <DashboardContent userId={user.id} />
        </main>
        <ToastNotification />
      </div>
    </NotificationProvider>
  );
}
