# ProofPilot

**An AI agent that wins PayPal disputes before they happen.** ProofPilot builds the evidence case at checkout, flags risky orders before you ship, and drafts a cited PayPal response the moment a dispute lands, so small sellers keep their money.

Built for the PayPal AI Hackathon 2026 by GURU SURYA RAJA J.

---

## The problem

When a buyer opens an *Item not received* or *Unauthorized* dispute, PayPal can hold the seller's funds while the case runs. Small sellers then scramble for tracking numbers, delivery proof and old messages against a deadline, and often lose by default. Almost every dispute tool starts working **after** the clock is already ticking.

## What ProofPilot does

| When | What the agent does | Built on |
|---|---|---|
| **Checkout** | Buyer pays with PayPal on the merchant's storefront. The server captures the payment and immediately builds an evidence pack from the capture response, a snapshot of the listing, the return-policy version the buyer accepted, and the checkout device/IP. | PayPal JS SDK, Orders v2 create + capture |
| **Before shipping** | Scores the order 0-100 from 9 explainable signals (new buyer, freight-forwarder address, value vs store average, prior disputes, velocity, express-to-forwarder, PayPal seller-protection status, unverified payer). Gemini explains medium/high-risk scores in plain English and recommends one action. | Rules engine + Gemini |
| **After checkout (buyer)** | The buyer gets a private order page (no account: an unguessable link on the receipt, or order number + email). It shows status, carrier tracking with a link to the carrier, a delivery estimate, and lets the buyer **message the shop** or confirm **"I received it"**. Both are recorded server-side with time, IP and device and filed into the evidence pack as verified evidence. "Where is my order?" and "damaged" messages show up on the seller dashboard as early warnings, so the seller can answer before the buyer opens a PayPal case. | Storefront API |
| **Fulfilment** | Tracking numbers are registered on the PayPal transaction. Delivery proof, buyer messages and documents are filed into the pack, and completeness updates live. | Orders v2 `/track` |
| **Dispute arrives** | Ingested by webhook or Disputes API polling, matched to the order by capture ID. The agent then, unprompted, checks what PayPal needs for that reason code, marks the gaps, estimates win likelihood and drafts a response that **only cites evidence in the pack**. | Disputes v1, Webhooks, Gemini |
| **One click** | The merchant reviews/edits the draft (citations re-verified on save) and submits. Evidence goes to PayPal as multipart `provide-evidence` with tracking info and the uploaded files. | Disputes v1 `provide-evidence` |

### Guardrails against hallucination
- The risk **score** is deterministic; the model only explains it.
- Every `[EV-…]` citation in a draft is checked against the evidence pack. A draft that cites a missing or nonexistent item is rejected and regenerated once with feedback, then replaced by a rules template built only from pack facts.
- Win likelihood from the model is capped by the evidence actually held (no "high" with a required item missing).
- Buyer messages are passed as data, not instructions.
- Responses are kept under PayPal's 2,000-character notes limit.

---

## Honest notes: what is real and what is simulated

| Capability | Status |
|---|---|
| Storefront checkout | **Real** PayPal sandbox checkout via the official JS SDK when `PAYPAL_CLIENT_ID`/`SECRET` are set. Without them, a clearly labelled *simulated checkout* is offered instead. |
| Payment data in the evidence pack | **Real** fields from the Orders v2 capture response (capture ID, seller protection, payer status, fee/net, shipping address). |
| Tracking | **Real** call to Orders v2 `/track` for PayPal orders. Carrier delivery status is entered by the merchant (no carrier API). |
| Disputes | **Real** sandbox disputes via webhook (`CUSTOMER.DISPUTE.*`, signature-verified with PayPal) and Disputes API polling. The sandbox cannot open a dispute through the API, so the console also offers **"Simulate buyer dispute"**, labelled *Simulation* everywhere. |
| Evidence submission | **Real** `provide-evidence` for PayPal disputes; if PayPal rejects it, the error and debug ID are shown, never a fake success. For simulated disputes the exact payload is recorded locally and marked "not sent". |
| AI | **Real** Google Gemini calls (`gemini-2.5-flash` by default) with JSON-schema-constrained output when `GEMINI_API_KEY` is set; Anthropic Claude is supported as an alternative (`ANTHROPIC_API_KEY`). Without a key a deterministic engine runs, labelled "Rules engine" in the UI. |
| Buyer order page | **Real** and server-recorded. A buyer's "I received it" counts as proof of delivery, and order-page messages count as the communication log; both are labelled with their source in the pack. It is the buyer's own acknowledgement, not a carrier scan. |
| Demo scenario | Optional, labelled "Demo". It runs through the same risk/evidence/AI pipeline as live orders. IPs use RFC 5737 documentation ranges. |
| "~40 min manual" | An **estimate**, labelled as such. ProofPilot's case-building time is **measured** (dispute ingested → draft ready). |

---

## Architecture

```
 Buyer ── Storefront (/store) ── PayPal JS SDK ──┐
                                                 │ create / capture
 Merchant ── Console (React) ──SSE + REST──► Express API ──► PayPal REST (Orders v2, Disputes v1, Webhooks)
                                                 │      └──► Google Gemini (JSON-schema output; Claude optional)
                                                 └──► Store: MongoDB  or  JSON snapshot (.data/)
 PayPal ── webhook (signature verified) ─────────┘
```

```
server/src/
  config.js                 env parsing
  index.js                  app, security headers (CSP allows the PayPal SDK), routing, static client
  lib/store.js              persistence (MongoDB or file), evidence file storage
  lib/events.js             Server-Sent Events + agent activity log
  lib/auth.js               opaque HttpOnly session cookie, login lockout
  data/catalog.js           products, shipping, store policy (server-side prices)
  routes/                   storefront, orders, disputes, system (auth, metrics, integrations, webhook)
  services/
    paypalClient.js         OAuth, Orders v2, tracking, Disputes v1, multipart evidence, webhooks
    checkoutService.js      create/capture checkout, simulated checkout, demo scenario
    orderService.js         ingestion, fulfilment, attachments, background AI explanations
    evidenceService.js      evidence pack derived from the order record
    riskService.js          deterministic 0-100 scoring
    aiService.js            Gemini/Claude calls, rate-limited priority queue, citation guardrail, rules fallback
    disputeService.js       ingest, autonomous analysis, draft edits, submission, sync, webhooks
    metricsService.js       KPIs, measured case-build time, hold early warning
client/src/
  pages/                    seller: Home, Orders, OrderDetail, Disputes, DisputeDetail, Settings, Login
                            buyer:  Store, StoreOrder (/store/orders/:token), StoreTrack (/store/track)
  components/StoreChrome    shared storefront header/footer
  components/               AppShell, EvidencePack, ActivityFeed, ui primitives, icons
  lib/                      api client, providers (auth, toasts, live events), formatters
  styles/                   PayPal-style design tokens and components
```

---

## Run it locally

Requires Node 20.19+.

```bash
npm run setup                       # installs server + client
cp server/.env.example server/.env  # then fill in what you have
npm run dev:server                  # API on http://localhost:4000
npm run dev:client                  # console on http://localhost:5173 (proxies /api)
```

Log in with `DEMO_EMAIL` / `DEMO_PASSWORD` (defaults: `merchant@proofpilot.local` / `change-me-before-demo`).
The storefront is at `/store`; buyers find their orders at `/store/track`.

Production-style single process: `npm run build && npm start`, then open http://localhost:4000.

### Connect the PayPal sandbox
1. At [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) create a sandbox REST app and copy its client ID and secret into `server/.env`.
2. Restart. **Settings → Test connection** performs a live OAuth call.
3. Pay on `/store` with a sandbox *personal* account. The order appears in the console live.
4. Add tracking to the order. It is registered on the PayPal transaction.
5. Log into sandbox.paypal.com as the buyer and open a dispute on that payment. It arrives within the polling interval (or instantly by webhook), and the agent drafts the response.
6. Optional webhook: set `PUBLIC_URL` (https), click **Register webhook** in Settings, then set `PAYPAL_WEBHOOK_ID` to the ID it reports.

### Connect Gemini
Set `GEMINI_API_KEY` in `server/.env` (optionally `GEMINI_MODEL`, default `gemini-2.5-flash`). Settings shows the model and the result of the last call.

Free-tier Gemini keys are rate limited (about 5 requests/minute, plus a daily cap per model). ProofPilot queues AI calls under `AI_REQUESTS_PER_MINUTE` (default 5), lets dispute drafts jump ahead of background risk explanations, retries once on 429/503, and only asks the model to explain medium and high-risk orders. If the daily cap is hit it switches to the rules engine until Google's reset and says so in Settings. To use Claude instead, set `ANTHROPIC_API_KEY` (and `AI_PROVIDER=claude` if both keys are present).

### Local MongoDB (Compass)
Set `MONGODB_URI=mongodb://127.0.0.1:27017/proofpilot` in `server/.env` with a local MongoDB running. Open the `proofpilot` database in MongoDB Compass to browse `orders`, `disputes`, `activity`, `sessions`, `checkouts`, `meta` and `files` (uploaded evidence). Without `MONGODB_URI` data goes to a JSON snapshot in `.data/`.

## Deploy to Render

`render.yaml` defines one web service (`npm run build` / `npm start`, health check `/api/health`). Set the secret env vars in the dashboard. Render's disk is ephemeral, so set `MONGODB_URI` (MongoDB Atlas free tier works) to keep data across deploys.

## Security
- Opaque random session tokens (stored hashed) in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); 5 failed logins lock an IP/email pair for 15 minutes.
- Helmet with a CSP limited to PayPal's domains (plus Google Fonts); CORS restricted; rate limiting; zod validation on every input.
- Prices are always recomputed from the server catalog; PayPal requests carry idempotency keys; captures are idempotent.
- Webhooks are accepted only after PayPal verifies their signature.
- Uploads limited to PDF/PNG/JPG/GIF up to 10 MB, served with `nosniff`.
- Buyer order links are 144-bit random tokens; the buyer view excludes risk scores, IPs and evidence internals. Order lookup returns one generic error for a wrong number or email and is limited to 10 tries a minute; buyer messages and confirmations are rate-limited and capped per order.
