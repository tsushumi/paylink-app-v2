import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket';
import { api, kes } from '../api';

// idle -> initiating -> waiting -> processing -> completed | failed
export default function PaymentPage() {
  const { linkId } = useParams();
  const [paymentLink, setPaymentLink] = useState(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [mock, setMock] = useState(false);
  const paymentIdRef = useRef(null);
  const statusRef = useRef('idle');
  const [receiptEmail, setReceiptEmail] = useState('');

  const apply = (data) => {
    // Never move backwards (e.g. a late "processing" after "completed").
    if (statusRef.current === 'completed' || statusRef.current === 'failed') return;
    if (data.status === 'processing') {
      statusRef.current = 'processing';
      setStatus('processing');
    } else if (data.status === 'completed') {
      statusRef.current = 'completed';
      setResult(data);
      setStatus('completed');
    } else if (data.status === 'failed') {
      statusRef.current = 'failed';
      setError(data.reason || 'Payment was not completed');
      setStatus('failed');
    }
  };

  useEffect(() => {
    api(`/payment-links/${linkId}`)
      .then(setPaymentLink)
      .catch(() => setLoadError('Payment link not found'));
  }, [linkId]);

  // WebSocket for live status. Handlers are named so cleanup removes exactly what was added,
  // which keeps StrictMode / remounts / reconnects from stacking duplicate listeners.
  useEffect(() => {
    const onStatus = (data) => apply(data);
    const join = () => {
      socket.emit('watch-payment', linkId);
      // After a reconnect, re-join the attempt room and pick up anything we missed.
      if (paymentIdRef.current) socket.emit('watch-payment-attempt', paymentIdRef.current, apply);
    };
    socket.on('payment-status', onStatus);
    socket.on('connect', join);
    socket.connect();
    return () => {
      socket.off('payment-status', onStatus);
      socket.off('connect', join);
      socket.disconnect();
    };
  }, [linkId]);

  // Safety net: poll while waiting, in case the socket is blocked (corporate proxies etc.).
  useEffect(() => {
    if (status !== 'waiting' && status !== 'processing') return;
    const t = setInterval(async () => {
      try {
        const s = await api(`/payments/${paymentIdRef.current}/status`);
        apply(s);
      } catch {
        /* ignore, socket may still deliver */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [status]);

  const handlePay = async (e) => {
    e.preventDefault();
    statusRef.current = 'initiating';
    setStatus('initiating');
    setError('');
    try {
      const data = await api('/payments/initiate', {
        method: 'POST',
        body: { paymentLinkId: linkId, phone, email },
      });
      paymentIdRef.current = data.paymentId;
      setReceiptEmail(email);
      setMock(!!data.mock);
      statusRef.current = 'waiting';
      setStatus('waiting');
      socket.emit('watch-payment-attempt', data.paymentId, apply);
    } catch (err) {
      statusRef.current = 'idle';
      setStatus('idle');
      setError(err.message || 'Something went wrong. Please try again.');
    }
  };

  const reset = () => {
    paymentIdRef.current = null;
    statusRef.current = 'idle';
    setStatus('idle');
    setError('');
    setResult(null);
  };

  if (loadError) {
    return (
      <div className="center-page">
        <div className="card pay-card"><p className="error">{loadError}</p></div>
      </div>
    );
  }
  if (!paymentLink) {
    return (
      <div className="center-page">
        <div className="card pay-card"><p className="muted">Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="card pay-card">
        <h1 className="merchant">{paymentLink.merchantName}</h1>
        <p className="muted">{paymentLink.description}</p>
        <p className="amount">{kes(paymentLink.amount)}</p>

        {status === 'idle' && (
          <form onSubmit={handlePay} className="form">
            <label className="field">
              <span>M-Pesa phone number</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" required autoComplete="tel" />
            </label>
            <label className="field">
              <span>Email (for your receipt)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn primary block">Pay {kes(paymentLink.amount)}</button>
          </form>
        )}

        {status === 'initiating' && (
          <div className="status-box">
            <div className="spinner" />
            <p>Sending payment request to your phone...</p>
          </div>
        )}

        {status === 'waiting' && (
          <div className="status-box" data-testid="status-waiting">
            <div className="pulse" />
            <p className="status-title">Waiting for payment...</p>
            <p>Check your phone for the M-Pesa prompt and enter your PIN.</p>
            <p className="muted small italic">This page updates automatically once the payment is confirmed.</p>
            {mock && <p className="demo">Demo mode: no real M-Pesa prompt is sent. The payment will confirm itself in a few seconds.</p>}
          </div>
        )}

        {status === 'processing' && (
          <div className="status-box" data-testid="status-processing">
            <div className="spinner" />
            <p className="status-title">Processing...</p>
            <p>M-Pesa responded. Confirming your payment.</p>
          </div>
        )}

        {status === 'completed' && result && (
          <div className="status-box success" data-testid="status-completed">
            <div className="check">✓</div>
            <h2>Payment received!</h2>
            <p>{kes(result.amount)} paid successfully.</p>
            <div className="receipt">
              <div><span>M-Pesa receipt</span><strong>{result.mpesaReceiptNumber}</strong></div>
              <div><span>Date</span><strong>{new Date(result.paidAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
            </div>
            {receiptEmail && <p className="muted small">A receipt has been sent to {receiptEmail}</p>}
          </div>
        )}

        {status === 'failed' && (
          <div className="status-box fail" data-testid="status-failed">
            <h2>Payment not completed</h2>
            <p>{error}</p>
            <button className="btn primary" onClick={reset}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
