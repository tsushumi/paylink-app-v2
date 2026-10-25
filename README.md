# PayLink v2

Payment links with **live** M-Pesa status. A merchant creates a link, shares it, and the payer watches the
payment confirm in real time. Every successful payment also triggers an email receipt, an SMS to the merchant,
and a notification-bell alert on the merchant dashboard, and feeds a 7-day analytics chart.

| Feature | How |
|---|---|
| Live payer status | Socket.IO: `Waiting for payment...` -> `Processing...` -> `Payment received!` (no refresh) |
| Email receipt | Resend, HTML + plain text, retry once after 1s, all user input HTML-escaped |
| Merchant SMS | Africa's Talking: `PayLink: Payment of KES 2,500 received from 0712345678.` |
| Notification bell | Persisted in DB, pushed over a socket, toast + unread badge, mark one / all read |
| Analytics | Total received, payment count, average, 7-day bar chart (bucketed in Nairobi time) |

**Tech:** Express 5, Socket.IO, Prisma 6 (SQLite by default), Resend, Africa's Talking, React 19 + Vite.

## Run it locally

```bash
# 1. Server
cd server
cp .env.example .env        # works as-is: mock mode, no API keys needed
npm install                 # also runs `prisma generate`
npm run db:push             # creates the SQLite database
npm run db:seed             # optional: demo merchant (demo@paylink.test) + a payment link
npm run dev                 # http://localhost:3001

# 2. Client (new terminal)
cd client
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Sign up (or log in as `demo@paylink.test`), create a link, open it in another tab/browser window, and pay.

### Mock mode (default)
With no keys set, nothing external is called, so you can demo the whole flow offline:
- **M-Pesa:** `MPESA_MOCK=true` skips Daraja. The server fires a fake successful callback
  `MPESA_MOCK_CALLBACK_DELAY_MS` (5s) after the STK Push, so you can watch "Waiting" flip to "Received".
- **Email / SMS:** logged to the server console instead of sent. Inspect them at `GET /api/dev/outbox`.

### Going live
Fill these in `server/.env` and set `MPESA_MOCK=false`:

| Variable | Notes |
|---|---|
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` | Daraja sandbox app |
| `MPESA_CALLBACK_URL` | Public HTTPS URL, e.g. `https://<id>.ngrok.app/api/mpesa/callback` |
| `MPESA_CALLBACK_TOKEN` | Optional shared secret; appended as `?token=` and checked on the callback |
| `RESEND_API_KEY`, `EMAIL_FROM` | `onboarding@resend.dev` only delivers to your own Resend account email until you verify a domain |
| `AT_USERNAME=sandbox`, `AT_API_KEY` | Sandbox SMS shows up in the Africa's Talking simulator, not on a real phone |
| `CLIENT_URL` | Your frontend origin (comma-separate several). Needed for CORS + sockets |

Client: set `VITE_API_URL` (ends in `/api`) and `VITE_SERVER_URL` (no `/api`).

## Architecture

```
Safaricom --POST--> /api/mpesa/callback  (replies 200 immediately)
                          |
                  paymentProcessor.handleStkCallback
                          |  atomic pending -> completed claim (duplicate callbacks are ignored)
        +-----------------+------------------+-------------------+
        v                 v                  v                   v
 Socket.IO room     Resend email        Africa's Talking     Notification row
 payment:<id>       receipt to payer    SMS to merchant      + Socket.IO room merchant:<userId>
 (payer's browser)  (never blocks)      (never blocks)       (bell, toast, live analytics refresh)
```

Design decisions that differ from the lesson skeleton, and why:
- **Socket.IO rooms instead of `Map`s.** A `Map<linkId, socketId>` lets a second payer on the same link overwrite
  the first, and a merchant with two tabs only ever gets one. Rooms (`payment:<id>`, `merchant:<id>`) handle both and
  clean up on disconnect automatically.
- **Idempotent callback.** Safaricom retries callbacks. The status flip is an atomic `updateMany ... where status='pending'`,
  so a retry can't send a second receipt/SMS/notification.
- **Email, SMS and bell are independent.** A Resend outage can't stop the merchant SMS or the notification.
- **Catch-up on connect.** `watch-payment-attempt` replies with the current status, so a callback that lands before the
  socket joins (or during a reconnect) is not lost. The payer page also polls `/payments/:id/status` every 4s as a fallback.
- **Time zone.** The analytics chart buckets days in `Africa/Nairobi`; UTC would put payments between 00:00-03:00 EAT on the wrong day.
- **Amount comes from the link,** never from the client.
- **Auth is deliberately minimal** (`x-user-id` header after email login, as in the lesson). Replace with JWT/sessions before real use.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | - | Merchant account (`name`, `email`, `phone`) |
| POST | `/api/payment-links` | merchant | Create link (`description`, `amount` 1-150000) |
| GET | `/api/payment-links` | merchant | Own links + paid counts |
| GET | `/api/payment-links/:id` | - | Public link details for the payer |
| POST | `/api/payments/initiate` | - | Start STK Push (`paymentLinkId`, `phone`, `email?`, `payerName?`) |
| GET | `/api/payments/:id/status` | - | Current payment status (poll fallback) |
| GET | `/api/payments` | merchant | 10 most recent payments |
| POST | `/api/mpesa/callback` | token | Safaricom STK result |
| GET | `/api/notifications` | merchant | List + `unreadCount` |
| POST | `/api/notifications/:id/read`, `/api/notifications/read-all` | merchant | Mark read |
| GET | `/api/analytics` | merchant | `totalReceived`, `totalPayments`, 7-day `chartData` |

Socket events: client -> `watch-payment(linkId)`, `watch-payment-attempt(paymentId, ack)`, `register-merchant(userId, ack)`;
server -> `payment-status`, `notification`.

Dev only (not mounted in production): `GET/DELETE /api/dev/outbox`, `POST /api/dev/simulate-callback {paymentId, success?}`,
`POST /api/dev/backdate`.

## Testing

```bash
cd server && npm run dev        # set MPESA_MOCK_AUTO_CALLBACK=false for deterministic timing
cd server && npm run test:flow  # 51 end-to-end checks (HTTP + sockets + email + SMS + analytics)
```

The suite covers: live status sequence, two payers on one link, merchant multi-tab delivery and isolation, receipt email
content and HTML escaping, SMS text, bell read/unread, duplicate callback idempotency, reconnect catch-up, the real callback
endpoint, analytics numbers and disconnect cleanup. A browser run (Playwright) of the same flows also passed, including mobile
overflow and console-error checks.

> **Note on the in-memory shim.** `npm run dev:shim` runs the server against `server/test/prismaShim.js`, a tiny stand-in for
> Prisma. It exists so the flow could be tested in an environment that cannot download Prisma's engines. Normal runs use the real
> Prisma client; please run `npm run test:flow` against `npm run dev` on your machine once to confirm your database setup.

## Screenshots (assignment checklist)

| State | File |
|---|---|
| Payment page, waiting | `docs/screenshots/01-payment-waiting.png` |
| Payment page, success + receipt | `docs/screenshots/02-payment-success.png` |
| Dashboard, bell with unread count + toasts | `docs/screenshots/03-dashboard-bell-toasts.png` |
| Notification dropdown (6 notifications) | `docs/screenshots/04-notification-dropdown.png` |
| Analytics (stats + chart) | `docs/screenshots/05-analytics.png` |
