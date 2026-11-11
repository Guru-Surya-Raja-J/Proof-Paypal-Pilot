# ProofPilot: Win PayPal Disputes Before They Happen

> Context file for Claude Code. Read this fully before writing any code. It explains WHAT we are building, WHY, HOW, and in WHAT ORDER.

---

## 0. Hard constraints (read first)

- **Event:** PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI"), hosted on Devpost.
- **Deadline:** 12 Nov 2026, 12:00 PM Pacific = **13 Nov 2026, 1:30 AM IST**. Submission is the FULL project, not just registration.
- **Time available:** about 3.5 days from 9 Nov 2026, 10:45 AM IST. Target "submitted" by the evening of 12 Nov IST. Do not leave submission to the last hour.
- **Builder:** GURU SURYA RAJA J, solo, full-stack MERN developer.
- **Hackathon rule:** the project must *meaningfully* use BOTH PayPal technology AND AI. There are no tracks or prescribed problems.
- **Judging criteria:** technical implementation, design, potential impact, innovation, presentation.
- **Special prizes we are targeting:** Best Use of PayPal + AI, Best Use of Agentic Commerce, Best Demo Delivery, plus sponsor bonus for Render (deploy there).
- **Deliverables:** working app, public GitHub repo, live demo link (deployed), ~2 minute demo video, Devpost story (already drafted), screenshots.

**Priority rule:** a small working end-to-end demo beats a big half-built one. If time runs short, cut features from the "Cut list" (section 14), never cut the demo flow.

---

## 1. The problem (why we are building this)

Small online sellers who take PayPal live with a recurring, well-documented pain:

1. A buyer opens a dispute ("Item not received", "Unauthorized", "Not as described").
2. PayPal can place a **hold** on the seller's funds (risk-based holds commonly last about 21 days; account limitations can last much longer).
3. The seller usually has no idea what evidence PayPal wants, scrambles to find tracking, proof of delivery, and communication logs, and often misses deadlines or loses.
4. PayPal's buyer protections are designed mainly to shield buyers, so merchants face an uphill battle.
5. Newer risk: AI shopping agents and automated flows may increase the volume of automated or false "Item Not Received" claims. PayPal itself has published about this in the context of agentic commerce.

PayPal's own public material also acknowledges the tension between **fraud prevention and smooth checkout** (false declines, friction, cart abandonment). Disputes and chargebacks are a core, long-running problem for PayPal and its merchants.

**Gap we exploit:** almost all dispute tools react *after* a dispute starts. They write a reply once the clock is already ticking.

---

## 2. The idea (what we are building)

**ProofPilot is an AI agent that prevents disputes from becoming losses by doing the evidence work BEFORE the dispute exists.**

One-line pitch: *AI agent that builds dispute-proof evidence at checkout, flags risky orders early, and drafts the PayPal response automatically, so small sellers keep their money.*

Core idea in three beats:

1. **At order time:** quietly collect and organize the proof a dispute would later need (order details, shipping/tracking, delivery status, buyer history, communications).
2. **Risk flagging:** score each order and warn the seller early about risky ones, with a plain-English reason (this is where AI explains *why*).
3. **When a dispute arrives:** the evidence case is already complete. The AI reads the dispute, checks what is missing, drafts the response to PayPal, and the seller submits it in one click.

Differentiation vs the hundred other "AI writes dispute replies" projects: **prevention plus a pre-built case**, a real agent that **takes actions** (not a chatbot), and a clear **before/after metric**.

---

## 3. Target user

A small merchant (solo seller, small Shopify/WooCommerce-style store, Etsy-like seller) who:
- Sells physical goods, ships to buyers, takes PayPal.
- Has no dedicated risk or finance team.
- Gets stressed by disputes and fund holds.

Persona for the demo: "Shikimori Handmade Goods is a small shop. 40 orders a week. One dispute used to cost the owner a whole evening and sometimes the money."

---

## 4. Honesty rules (important)

- Only claim integrations that actually work. Judges check demos against the story.
- If PayPal sandbox cannot do something (e.g. creating disputes programmatically), **use a clearly labeled simulation layer** and say so in the demo and README ("simulated dispute events because sandbox does not expose X"). Be upfront, do not fake it silently.
- Never let the AI invent facts in dispute responses. It may only use evidence present in the case record. If evidence is missing it must say so and list what is missing.
- Use sandbox/test data only. No real customer data, no real credentials committed to git.

---

## 5. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, React Router |
| Backend | Node.js, Express |
| Database | MongoDB (Atlas free tier), Mongoose |
| PayPal | PayPal Sandbox REST APIs (Orders v2, Disputes, Shipment Tracking). Use PayPal Agent Toolkit / MCP server if it speeds things up (verify package names in docs first) |
| AI | LLM via API (recommended: Anthropic Claude API using `@anthropic-ai/sdk`; make model name an env var). Use structured JSON outputs |
| Deploy | Render (frontend static + backend web service). Hackathon has a Render bonus prize |
| Misc | dotenv, zod (validation), axios, cors, morgan |

**Do not over-engineer.** No microservices, no queues, no auth beyond a simple demo login (or none).

---

## 6. Architecture

```
React dashboard  <---->  Express API  <---->  MongoDB
                              |
                    +---------+----------+
                    |                    |
              PayPal Sandbox         LLM API
        (orders, tracking, disputes)  (risk explain, gap analysis, draft reply)
```

Key backend modules (keep each small):

- `paypalClient` : OAuth token handling + thin wrappers for PayPal calls. Has a **mock adapter** with the same interface for anything the sandbox cannot do. Selected via env var `PAYPAL_MODE=sandbox|mock`.
- `evidenceService` : builds/updates the evidence pack for an order.
- `riskService` : rule-based score plus AI explanation.
- `disputeService` : ingests a dispute, runs gap analysis, drafts response, submits evidence.
- `aiService` : all LLM calls live here, with strict JSON schemas and prompt templates.

---

## 7. Data models (Mongoose)

**Order**
- `paypalOrderId` (string), `status`
- `buyer`: `{ name, email, country, accountAgeDays?, previousOrders, previousDisputes }`
- `items[]`: `{ name, sku, qty, price }`, `total`, `currency`
- `shipping`: `{ address, carrier, trackingNumber, shippedAt, deliveredAt, deliveryStatus }`
- `risk`: `{ score (0-100), level (low|medium|high), signals[], aiExplanation, computedAt }`
- `evidencePackId` (ref)
- `createdAt`

**EvidencePack**
- `orderId`
- `items[]`: `{ type, label, source, data, collectedAt }` where `type` is one of `order_receipt`, `tracking`, `delivery_confirmation`, `buyer_communication`, `product_description`, `refund_policy`, `buyer_history`, `ip_device_match`
- `completeness`: `{ percent, missing[] }`

**Dispute**
- `paypalDisputeId`, `orderId`, `reason` (`ITEM_NOT_RECEIVED` | `UNAUTHORISED` | `NOT_AS_DESCRIBED` | ...), `status`, `amount`, `openedAt`, `responseDueAt`
- `analysis`: `{ requiredEvidence[], haveEvidence[], missingEvidence[], winLikelihood (low|medium|high), reasoning }`
- `draftResponse`: `{ text, citedEvidenceIds[], generatedAt }`
- `submission`: `{ submittedAt, paypalResponse }`
- `timeline[]`: `{ at, event, note }`

**ActivityLog** (powers the live "agent actions" feed in the UI)
- `at`, `agentAction`, `target`, `result`

---

## 8. Features (in build order)

### F1. Order ingestion + evidence pack (MUST)
- Create sandbox orders via PayPal Orders v2 (or seed them).
- On order creation, auto-create an EvidencePack and attach: receipt, product description, refund policy snippet, buyer history.
- When tracking is added, attach tracking + delivery confirmation.
- Show a **completeness meter** per order (e.g. "Evidence 85%, missing: delivery confirmation").

### F2. Risk flagging (MUST)
Rule-based scoring (deterministic, fast, explainable) producing 0-100:
- New buyer / no history: +15
- Shipping address differs from billing / country mismatch: +20
- Order value > 3x seller average: +20
- High-risk product category flag: +10
- Buyer has prior disputes: +25
- Multiple orders from same buyer in short window: +10
- Rush shipping to freight-forwarder style address: +15

Levels: <35 low, 35-65 medium, >65 high. Then the LLM takes the signals and writes a short plain-English explanation plus a **recommended action** ("require signature on delivery", "ship with tracking and photo proof", "hold shipment until verified"). LLM must not change the score, only explain it.

### F3. Dispute ingestion (MUST)
- Pull disputes via PayPal Disputes API if sandbox supports it. Otherwise provide a **"Simulate buyer dispute"** button that creates a Dispute record for a chosen order (clearly labeled simulation).
- Compute `responseDueAt` and show a countdown.

### F4. Gap analysis + draft response (MUST, the hero feature)
- Input: Dispute (reason, amount) + order + evidence pack.
- LLM returns strict JSON: required evidence for this dispute reason, which we have, which are missing, win likelihood, reasoning.
- LLM drafts a professional, factual response to PayPal that **only cites evidence in the pack**. Output includes citations to evidence item IDs.
- UI shows the draft side by side with the evidence items it cites, with an editable text box.

### F5. One-click submit (MUST)
- Button "Submit to PayPal". Calls Disputes API `provide-evidence` in sandbox if it works; otherwise mock adapter. Log result in ActivityLog and dispute timeline. UI shows a success state with what was sent.

### F6. Agent activity feed (SHOULD)
- Right-hand live feed showing what the agent did: "Collected tracking for order #1042", "Flagged order #1047 (high risk: new buyer + value 4x average)", "Drafted response for dispute D-9". This is what makes it feel like an **agent**, not a chatbot. Cheap to build from ActivityLog.

### F7. Impact metrics panel (SHOULD)
- Show: time to build a case (manual estimate vs ProofPilot), % of disputes with complete evidence, orders flagged. The manual estimate should be a clearly stated assumption (e.g. "~40 min manual vs seconds"), not a fake measured stat. Label it as an estimate.

### F8. Hold early-warning (NICE, only if time)
- Simple panel: seller dispute rate vs 1% threshold, new-account and volume-spike signals, "hold risk: low/medium/high".

---

## 9. API routes (Express)

```
POST   /api/orders/seed            seed demo orders
GET    /api/orders                 list with risk + completeness
POST   /api/orders                 create sandbox order
GET    /api/orders/:id             detail + evidence pack
POST   /api/orders/:id/tracking    add tracking, update evidence
POST   /api/orders/:id/risk        (re)compute risk + AI explanation

GET    /api/disputes               list
POST   /api/disputes/simulate      body: { orderId, reason }  (labeled simulation)
POST   /api/disputes/:id/analyze   gap analysis + draft response
PUT    /api/disputes/:id/draft     edit draft
POST   /api/disputes/:id/submit    send evidence to PayPal (sandbox or mock)

GET    /api/activity               agent activity feed
GET    /api/metrics                dashboard metrics
GET    /api/health
```

---

## 10. AI prompts (principles)

All LLM calls: low temperature, JSON-only output validated with zod, retry once on invalid JSON, hard fail to a safe fallback message.

**Risk explainer prompt (summary):** "You are a fraud-risk assistant for a small merchant. Given these risk signals and order facts, explain in 2 sentences why this order is risky and recommend ONE concrete action. Do not change the score. Do not invent facts."

**Gap analysis prompt (summary):** "Given dispute reason, order data, and evidence pack, list evidence PayPal typically needs for this reason, mark which are present and missing, estimate win likelihood (low/medium/high) with reasoning. Use only the provided data."

**Draft response prompt (summary):** "Write a concise, factual, professional response to PayPal for this dispute. Use ONLY evidence items provided and cite them by ID. If key evidence is missing, state the facts that are known and do not claim anything unsupported. Tone: calm, specific, no emotion."

Guardrail: after generation, programmatically verify every cited evidence ID exists in the pack. Reject and regenerate if not.

---

## 11. UI screens

1. **Dashboard:** metrics cards, orders table with risk badge and evidence completeness bar, agent activity feed.
2. **Order detail:** order info, risk explanation + recommended action, evidence pack list, add-tracking form.
3. **Dispute detail (hero screen):** reason, amount, countdown, gap analysis (have/missing), AI draft response next to cited evidence, edit box, Submit button, timeline.
4. **Simulate dispute modal:** pick order + reason, clearly labeled "demo simulation".

Design: clean, modern, one accent color, clear risk colors (green/amber/red), good empty and loading states, mobile-friendly enough. Polish matters for the design criterion.

---

## 12. Demo script (2 minutes, build the app to make THIS smooth)

1. (0:00) Problem: one sentence about sellers losing money to disputes and holds.
2. (0:15) Dashboard: orders with evidence meters; agent feed shows it collecting proof automatically.
3. (0:35) A new risky order appears flagged red with the AI explanation and recommended action.
4. (0:55) Click "Simulate buyer dispute: Item Not Received" on a normal order.
5. (1:05) Open dispute: evidence already 90% complete, one gap flagged, draft reply ready with citations.
6. (1:30) Edit one line, click Submit; PayPal sandbox response and timeline update.
7. (1:45) Metrics: "case built in seconds vs ~40 minutes by hand (estimate)". Close with the prevention-first message and what is next.

---

## 13. Build plan (IST)

- **Mon 9 Nov (today):** repo + skeleton (Vite React, Express, Mongo connection). PayPal developer account, sandbox app, OAuth token working, ONE successful API call (create/fetch an order). Check sandbox support for Disputes API and tracking. Write the mock adapter interface. Seed data script. **Goal: PayPal connection proven.**
- **Tue 10 Nov:** F1 + F2: orders, evidence packs, risk scoring, AI explanation, dashboard and order detail UI.
- **Wed 11 Nov:** F3 + F4 + F5: disputes, gap analysis, draft, submit. Agent feed. Deploy to Render.
- **Thu 12 Nov:** metrics panel, polish, bug fixes, screenshots, record demo video, fill the Devpost bracket placeholders with real facts, write README, SUBMIT by evening IST (deadline is 1:30 AM IST on 13 Nov).

---

## 14. Cut list (drop in this order if behind schedule)

1. F8 hold early-warning
2. F7 metrics polish (keep a simple version)
3. Real PayPal order creation (seed orders instead, keep ONE real sandbox call somewhere)
4. Editable draft box (keep read-only draft)
Never cut: seeded orders, risk flag, simulated dispute, gap analysis, AI draft with citations, submit action, deployed link.

---

## 15. Repo structure

```
proofpilot/
  README.md
  overview.md
  .env.example
  server/
    src/
      index.js
      config/
      models/        Order, EvidencePack, Dispute, ActivityLog
      routes/
      services/      paypalClient (sandbox + mock), evidenceService, riskService, disputeService, aiService
      prompts/
      seed/
  client/
    src/
      pages/         Dashboard, OrderDetail, DisputeDetail
      components/
      api/
```

## 16. Environment variables

```
MONGODB_URI=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_MODE=sandbox            # sandbox | mock
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
LLM_API_KEY=
LLM_MODEL=                     # e.g. claude-sonnet-5-5 (verify in docs)
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
```

Never commit real keys. Provide `.env.example` only.

---

## 17. Definition of done

- [ ] Deployed live link works from a fresh browser
- [ ] Seeded demo data loads with one click
- [ ] Risk flags + AI explanation visible
- [ ] Dispute simulate to analyze to draft to submit works end to end
- [ ] At least one genuine PayPal sandbox API call in the flow, honestly described
- [ ] Agent activity feed shows real logged actions
- [ ] README with setup, architecture, honest notes on simulated parts

---

## 16. Copilot implementation log (2026-11-09)

This section is the current handoff for other agents. The implementation was started by **Copilot**.

### System design decisions

- **User roles:** one `merchant` role for the hackathon MVP. A merchant can view protected orders, inspect evidence completeness, simulate a dispute, run analysis, edit the generated response in the UI, and submit the evidence package. Admin, buyer, and support roles are intentionally out of scope for the demo.
- **Client/server boundary:** `client/` is the React + Vite dashboard; `server/` is the Express API. The client calls the API with `credentials: include`.
- **PayPal boundary:** the server owns the future PayPal adapter. The current dispute simulation and submission response are explicitly mock/demo behavior; no live PayPal dispute is silently claimed.
- **AI boundary:** the current server produces deterministic, evidence-grounded analysis so the end-to-end demo works without exposing an API key. The `analysis` and `draftResponse` shapes are ready for a provider-backed AI service to replace this logic.
- **Persistence boundary:** the current data store is in-memory for a fast, reliable hackathon demo. MongoDB/Mongoose should replace the maps before production deployment without changing the route contract.

### Implemented by Copilot

- Replaced the Vite starter UI with a ProofPilot merchant workspace in `client/src/App.jsx`.
- Added dashboard metrics, protected orders, risk labels, evidence completeness, agent activity feed, dispute simulation controls, gap analysis, cited draft response, countdown, and mock submit state.
- Added responsive visual styling in `client/src/App.css` and a minimal global stylesheet in `client/src/index.css`.
- Reworked the dashboard into a PayPal-inspired merchant console: persistent navigation, account/security status, overview metrics, risk filters, order selection, activity history, education strip, mobile layout, and dispute workbench.
- Added the PayPal-style navy/blue visual system, compact merchant-finance spacing, accessible labels, responsive breakpoints, and browser theme metadata. This is an original ProofPilot interface inspired by PayPal's product language, not a copied proprietary screen.
- Refined the end-to-end UX: the first protected order is selected automatically, sidebar navigation scrolls to real workspace sections, action buttons expose progress states, the dispute countdown uses server-provided data, and edited response text is persisted into the submit request.
- Added `server/src/index.js` with health, auth, orders, activity, tracking, dispute simulation, analysis, and submission endpoints.
- Added demo data for orders `1042`, `1047`, and `1049` and a clear simulated-dispute timeline note.
- Added `server/.env.example` for environment configuration.

### Security controls implemented

- No JWT is used. Authentication uses a random opaque session token stored server-side and sent only in an `HttpOnly` cookie.
- Session cookies use `SameSite=Lax`, `Path=/`, an eight-hour lifetime, and `Secure` automatically in production.
- Login attempts are limited per IP/email key: five failed attempts lock that key for 15 minutes.
- General API rate limiting is enabled at 120 requests per minute.
- Helmet security headers, CORS origin restriction, JSON body size limit, Zod request validation, disabled `x-powered-by`, and generic server error responses are enabled.
- Credentials are read from environment variables; never commit a real password, PayPal credential, or AI key.
- Follow-up hardening before production: move sessions, users, and lockout state to MongoDB/Redis; add CSRF protection for cookie-authenticated state-changing requests; use a reverse proxy with TLS; add audit persistence and secret rotation.

### Continuation notes

- Start the API from `server/` with `npm install` then `npm run dev`.
- Start the client from `client/` with `npm install` then `npm run dev`.
- Default demo credentials are `merchant@proofpilot.local` and `change-me-before-demo`; override them through `server/.env`.
- The current source is intentionally small and vertical-slice focused. Preserve the route contracts while extracting Mongoose models, PayPal adapters, and provider-backed AI.
- [ ] Public GitHub repo
- [ ] 2-min demo video recorded and uploaded
- [ ] Devpost: name, pitch, story (no [brackets] left), Built With tags, links, screenshots, thumbnail
- [ ] Submitted BEFORE 13 Nov 1:30 AM IST (aim: evening of 12 Nov)

## 18. Questions Claude Code should resolve early (check docs, do not guess)

1. Which PayPal sandbox APIs are available for disputes and tracking, and what are their exact endpoints and scopes?
2. Can sandbox disputes be created programmatically, or only through the sandbox buyer account in the resolution center?
3. Is the PayPal Agent Toolkit / MCP server usable in this stack, and is it worth the time versus direct REST calls?
4. Exact package names and model identifiers (do not assume).

If any answer blocks progress for more than 30 minutes, switch that piece to the mock adapter and move on.

---

## 19. Antigravity implementation log (2026-11-09)

This section documents the end-to-end analysis, architecture upgrades, and feature completions executed by **Antigravity**.

### System analysis & gaps identified in basecode

Prior to this pass, the codebase had a working vertical slice UI and basic Express shell from Copilot, but was lacking behind in several key hackathon specifications:
1. **No Order Inspection or Tracking UI:** Clicking an order in the dashboard only selected its ID; there was no way to inspect the buyer profile, shipping address, evidence items, or risk breakdown. Furthermore, although the server exposed a tracking endpoint, there was no UI anywhere to input a tracking number.
2. **Missing Risk Engine:** The server used static, hardcoded numbers for risk without calculating the signals detailed in Section 8 F2 (new buyer, freight forwarder, 3x order value, prior dispute). No plain-English AI explanations or recommended actions were generated.
3. **Draft Response Lacked Depth & Evidence Citation:** The dispute response draft was a 3-line static string that didn't tailor to dispute reasons (`ITEM_NOT_RECEIVED`, `UNAUTHORISED`, `NOT_AS_DESCRIBED`) or cite actual evidence records.
4. **Missing PayPal Client Module:** No PayPal API client or OAuth token logic existed; the server had zero integration code for PayPal Sandbox REST APIs.
5. **No Monorepo Developer Tooling:** The repository had no root `package.json`, causing root `npm` commands to crash with `ENOENT`. `README.md` was still the default Vite boilerplate.
6. **No Demo Reset or Ingestion Controls:** Once a dispute was simulated or submitted, there was no way to reset demo state or simulate new checkouts without restarting the server process.

---

### Implemented by Antigravity

#### 1. Root Monorepo & Developer Tooling
- Added root `package.json` with scripts: `dev:server`, `dev:client`, `build:client`, `build`, and `start`.
- Created comprehensive root and server `.env.example` templates documenting all PayPal Sandbox, AI, and auth configuration keys.
- Rewrote `README.md` into a hackathon-grade document containing problem architecture, dual-mode PayPal setup, quickstart instructions, and a 2-minute demo pitch guide for judges.
- Synchronized `filestructure.txt` with the expanded modular file tree.

#### 2. Backend Services & Business Logic Architecture
- **`server/src/services/riskService.js`**:
  - Implemented the full 7-vector fraud risk engine: First-time buyer (+15), Freight forwarder / address mismatch (+20), High order value > 3x store average (+20), High risk product category (+10), Prior buyer disputes (+25), Velocity spike (+10), Rush shipping to forwarder (+15).
  - Categorizes into `low` (<35), `medium` (35-65), and `high` (>65) risk levels.
  - Automatically generates plain-English contextual AI risk explanations and actionable merchant recommendations (e.g. "Require direct adult signature upon delivery, take pre-shipment photos, and delay dispatch by 12 hours for verification").
- **`server/src/services/evidenceService.js`**:
  - Auto-assembles 6 distinct verified evidence types for each order: PayPal Verified Order Receipt (API), Product Catalog Spec, Store Return Policy, Buyer Reputation & History, Carrier Shipment Tracking, and Proof of Delivery (POD).
  - Implemented dynamic, weighted evidence completeness calculation (0–100%) and missing gap detection.
- **`server/src/services/aiService.js`**:
  - Implemented structured AI gap analysis tailored to dispute reason (`ITEM_NOT_RECEIVED`, `UNAUTHORISED`, `NOT_AS_DESCRIBED`).
  - Evaluates required evidence vs available evidence to determine win likelihood (`HIGH`, `MEDIUM`, `LOW`) and generates evidence-grounded reasoning.
  - Generates formal, professional merchant defense letters citing **strictly verified evidence IDs** from the pack. Enforces zero-hallucination citation guardrails.
- **`server/src/services/paypalClient.js`**:
  - Dual-mode PayPal client: integrates with live PayPal Sandbox REST APIs (OAuth 2.0 token management, Orders v2 creation, Shipment Tracking v1, Disputes Resolution) while providing an honest, transparent simulation mock fallback when credentials are not configured.
  - Exposes `getPayPalStatus()` reporting active mode and scope.
- **`server/src/data/seedData.js`**:
  - Enriched merchant order dataset with 4 archetypal orders (Low Risk with tracking, High Risk with freight forwarder and missing proof, Medium Risk with prior dispute, Low Risk delivered with electronic signature).

#### 3. Frontend & Merchant Dashboard Enhancements (`client/src/App.jsx` & `App.css`)
- **Order Intelligence & Evidence Dossier Modal:** Clicking any order opens a comprehensive inspection drawer showing:
  - Buyer Profile (PayPal account age, prior orders, dispute records).
  - Shipping & Fulfillment breakdown (carrier, tracking, destination).
  - Risk Assessment Callout (score gauge, risk badge, bulleted signals list with points, AI explanation, recommended merchant action).
  - Pre-emptive Evidence Pack (status of each evidence card with collection timestamp).
- **Interactive Carrier Tracking Form:** Built directly into the order modal; merchants can select carriers (USPS, UPS, FedEx, DHL, Royal Mail) and enter a tracking number. Submitting updates the order, recalculates completeness, re-runs risk scoring, and logs the action to the live agent feed.
- **Evidence Record Inspector:** Merchants can click on any evidence card or checklist chip to view the raw structured record (API transaction ID, carrier scan timestamps, checkout policy text).
- **Hero Dispute Workbench:**
  - Response due countdown timer with urgency styling.
  - Evidence gap checklist with one-click links to inspect verified proof.
  - Interactive case progression timeline visualizing all stages (simulated -> evidence retrieved -> AI analysis -> draft formulated -> merchant edited -> submitted).
  - Post-submission receipt card confirming official PayPal submission ID, timestamp, and status.
- **Early Hold-Warning Gauge (Feature F8):** Visual indicator monitoring the merchant's store dispute ratio against PayPal's 1.0% hold threshold (status: `Hold Risk: LOW (Safe)`).
- **Demo Tools & Order Simulator:**
  - Added **"Reset Demo"** button: instantly resets the state back to clean baseline during live presentations.
  - Added **"+ Ingest Order"** modal: allows simulating a new buyer checkout order with custom total, destination, and freight forwarder flags, demonstrating live risk scoring.
  - Added **"PayPal Sandbox"** status pill in the topbar explaining active mode with instructions for connecting live developer credentials.

#### 4. Verification & Testing
- Root scripts tested and verified (`npm run build:client` built in 522ms).
- Node server syntax check passed with zero errors (`node --check server/src/index.js`).
- Complete automated end-to-end API integration test executed:
  - Login session creation (`POST /api/auth/login`) -> Verified
  - Orders listing (`GET /api/orders`) -> Verified (4 orders loaded)
  - Carrier tracking attachment (`POST /api/orders/1047/tracking`) -> Verified (completeness jumped to 100%, status updated to delivered)
  - Dispute simulation (`POST /api/disputes/simulate`) -> Verified (Case DSP created)
  - AI gap analysis (`POST /api/disputes/:id/analyze`) -> Verified (win likelihood calculated, evidence citations verified)
  - Draft editing & submission (`POST /api/disputes/:id/submit`) -> Verified (accepted by PayPal adapter with submission ID)
  - Real-time metrics calculation (`GET /api/metrics`) -> Verified
  - Demo state reseed (`POST /api/orders/seed`) -> Verified

#### 5. Session Stability & Anti-Flicker Hardening
- **Root Cause of Login Flash on Refresh:** `user` state was initialized to `null`. On every page reload, React executed initial paint rendering `<Login />` while `fetch('/api/auth/me')` was in flight over HTTP, causing a 200–500ms login flash before transitioning to the dashboard.
- **Synchronous Session Hydration:** Initialized `user` synchronously from `localStorage.getItem('proofpilot_user')`, enabling immediate, frame-1 dashboard rendering on refresh with zero visual flickering.
- **Dual-Channel Auth:** The backend now supports both HttpOnly session cookies and an `Authorization: Bearer <token>` fallback header, making authentication immune to cross-origin port sandboxing or browser cookie blocking.
- **Disk-Backed State Persistence:** Active sessions are persisted in `.data/sessions.json` and merchant orders in `.data/store.json`, ensuring server restarts or watch-reloads never invalidate sessions or discard demo changes.
- **Defensive Error Handling:** Implemented safe URI decoding for cookie parsing, CORS support for all localhost/127.0.0.1 development ports, and unified `logout()` cleanup.


---

## 20. Claude Code rebuild (2026-11-09): current state, supersedes sections 16 and 19

The Copilot/Antigravity base was a UI over hardcoded data (fixed "Austin TX" origins, invented "3D-Secure" claims in drafts, a constant "2.8h saved", a PayPal client that was never on the checkout path). It was rebuilt so every number and evidence item comes from a real record. **Sections 16 and 19 describe code that no longer exists.**

**Live flow:** `/store` (PayPal JS SDK) → server creates + captures the Orders v2 order (prices from `server/src/data/catalog.js`) → `ingestOrder` builds the evidence pack from the capture + listing snapshot + accepted policy version + checkout IP/UA → deterministic risk score → Claude explanation in the background → tracking registered with `/v2/checkout/orders/{id}/track` → disputes arrive via verified webhook or Disputes API polling, matched by capture ID → the agent auto-runs gap analysis + cited draft → merchant edits (citations re-verified) → multipart `provide-evidence` with tracking info and uploaded files.

**Key decisions**
- Persistence: in-memory working set, write-through to MongoDB (`MONGODB_URI`) or a JSON snapshot in `.data/` (not Mongoose; the single-merchant data set is small). Evidence files are stored as binary in Mongo or under `.data/uploads`.
- Evidence packs are *derived* from the order record on every change (`evidenceService.buildEvidencePack`), never edited directly.
- AI: `@anthropic-ai/sdk` `beta.messages.parse` + `betaZodOutputFormat`, model `claude-opus-5-5`, server-side refusal fallback (`fallbacks: "default"`). Guardrail in `aiService.validateDraft`. Without a key the rules engine runs and the UI labels it.
- Simulation is explicit: `source` is `paypal | simulated | demo` on orders and `paypal | simulated` on disputes, shown as badges everywhere. Simulated submissions are recorded as "not sent".
- Live UI: Server-Sent Events (`/api/events`); the client refetches the affected resource.
- Deploy: one Render web service (`render.yaml`); Express serves `client/dist`.

**Verified on 2026-11-09:** ESLint clean; Vite build; full browser walkthrough with Playwright (login, demo load, risk view, simulate dispute, citation jump, submit, storefront checkout reaching the console live, mobile at 390 px with no horizontal overflow); the complete sandbox path against a stand-in PayPal server reproducing the real response shapes (OAuth, create/capture, track, disputes list/detail, multipart provide-evidence, status refresh); Claude failure fallback against the real API with an invalid key.

**Not yet verified (needs real keys):** a live PayPal sandbox account end to end, and live Claude output quality.

### Update (2026-11-09, later): Gemini + local MongoDB
- **AI provider is now Google Gemini** (`@google/genai`, `apiVersion: 'v1beta'`, `responseJsonSchema` from the zod schemas), default model `gemini-2.5-flash`. Claude remains supported (`AI_PROVIDER`). Key lives in `server/.env` as `GEMINI_API_KEY` (git-ignored).
- Free-tier limits shaped the design: AI calls go through a priority queue paced by `AI_REQUESTS_PER_MINUTE` (default 5); dispute drafts outrank risk explanations; one retry on 429/500/503; a per-day quota hit trips a breaker until Pacific midnight; only medium/high-risk orders get AI explanations. Note: `gemini-3.5-flash` allows only 20 free requests/day, so it is not the default.
- Drafts are returned as greeting / paragraphs[] / sign-off and assembled server-side, because the model sometimes omitted newlines.
- **Database: local MongoDB** at `mongodb://127.0.0.1:27017/proofpilot` (view in Compass). Verified: orders, disputes, activity, sessions, files persisted; sessions survive restarts.
- Verified live with the real Gemini key: risk explanations for the high/medium orders, a dispute draft where the guardrail rejected the first attempt and the retry passed, and a re-draft after adding proof of delivery that cites it and lifts win likelihood to high.

## 21. UI redesign + shop/seller switching (2026-11-10)

**Brand.** The shop is **Shikimori Handmade Goods** everywhere (`MERCHANT_NAME` in `server/.env`, both `.env.example` files, the `config.js` default, support email `support@shikimorihandmade.example`). `auth.currentUser` always returns the name from config, so renaming never leaves stale sessions. Old dispute drafts keep the signature they were written with; Re-draft rewrites them.

**Switching.** `client/src/components/ViewSwitch.jsx` is the only Shop | Seller control, the same on both sides: same tab, client-side `Link`, no new tabs. The browser tab title follows the side (`<shop> · Shop` / `<shop> · ProofPilot seller console`).

**Look and feel (seller console).** Modelled on PayPal's account UI without its logo: navy top bar (`--pp-header #142c8e`), pill nav, gold count badge, outlined avatar, borderless 20px cards (`--card-shadow`), Inter font, sentence-case labels, tabular numbers, pill buttons (`btn-dark #001c64`, secondary with a 1.5px navy border). Icons are **Lucide** (`lucide-react@0.468.0`) behind the unchanged `<Icon name>` API in `Icon.jsx`. Deliberately removed as "vibecoded": the Live indicator, icons on KPI labels, red headline numbers. All styles live in `client/src/styles/app.css`; later passes are appended as sections that override earlier rules (PayPal account look → Pass 4 → timeline → sync → draft).

**Screens**
- **Home** (`pages/Home.jsx`): balance-style hero ("Volume protected", two actions, three stats), Needs your attention (whole row clickable), Recent orders as activity rows (initials, buyer, order · time, amount + risk chip). The sidebar holds hold warning, case time and Agent activity at their natural height (a sticky, height-clamped sidebar was tried and reverted because it squeezed the feed).
- **Agent activity** (`components/ActivityFeed.jsx`): timeline grouped by day, an icon per action (`iconFor`), compact times (`24m`, `14h`), details limited to 2 lines, model ids hidden. Shows 4 items, then Show more; the expanded list scrolls inside the card and never runs past the screen.
- **Risk chip** (`ui.jsx RiskBadge`): soft tonal pill, dot + level + score.
- **Disputes** (`pages/Disputes.jsx`): one honest status line derived from the last real sync (`connectionStatus`: checking / simulation / keys rejected / connected), a summary strip (open, on hold, next deadline, submitted), filter chips (Needs action / Submitted / All), and case rows in place of the table. The sync control spins while running and shows "Synced Xm ago"; when PayPal rejects the keys it becomes **Fix PayPal keys** and links to `/settings#paypal`.
- **Dispute detail** (`pages/DisputeDetail.jsx`): the AI fallback is a one-line note (`aiFallbackReason`), the draft sits in a document frame (character and citation counts, Copy), citation chips carry a shield icon, and the case timeline has an icon per event (`timelineIcon`) with notes limited to 3 lines.
- **Settings** (`pages/Settings.jsx`): status tiles (PayPal / AI / Storage) that jump to their section; the PayPal state comes from the last OAuth/sync result, not from whether keys are set; the webhook setup is a 3-step checklist (public URL → registered → `PAYPAL_WEBHOOK_ID`).
- **Login**: centered card, "Shop as a buyer" as the secondary action.
- **Storefront** (buyer side keeps its own handmade-shop look): hero with perks, a buyer-friendly "Demo store" note, "In cart · n" on product buttons, a sticky cart bar on phones, 2-column products on phones.
- **Phone (≤560px):** white bottom tab bar, 2-up KPIs, tables hide secondary columns (`hide-sm` / `show-sm`).

**Server copy.** Evidence types in activity details are readable ("other", not "OTHER"); no "(s)" plurals anywhere.

**PayPal status (fixed 2026-11-10).** The sandbox keys work: OAuth returns 200 (app `APP-1NL253395J859084A`), dispute sync runs, and the storefront renders the real PayPal and card buttons. The cause was one stray character typed onto the end of the pasted secret (81 chars instead of 80). One transient `invalid_client` appeared a minute after the fix and cleared on retry; that is normal for sandbox apps created in the last hour or so. No webhook is needed for the demo: polling every 120s covers disputes, and a webhook needs a public https `PUBLIC_URL`. Settings now takes the PayPal state from the latest OAuth check, so an older webhook error can no longer show "Keys rejected".

**Verified 2026-11-10:** ESLint clean; Playwright screenshots of every seller page and the storefront at 1440px and 390px with no console errors; Seller → Shop → Seller switch works in the same tab; the expanded activity feed stays inside the viewport (Show less ends at 756 of 820px); the sandbox OAuth check returns 401 with the current secret.

## 22. Buyer order page, product dialog, end-to-end verification (2026-11-11)

**Why.** Most "item not received" disputes start with a buyer who cannot find their tracking. The buyer side now closes that gap, and what the buyer does there becomes evidence.

**Buyer side (new)**
- `/store/orders/:token` (`pages/StoreOrder.jsx`): status headline + 3-step progress, carrier tracking with a carrier link and a business-day delivery estimate, **message the shop** (topics: where is my order, damaged, not as described, return, other), **"Yes, I received it"**, order summary, ship-to, the policy version accepted at checkout. Shows "PayPal case open" when a dispute exists.
- `/store/track` (`pages/StoreTrack.jsx`): look up by order number + email; "On this device" list (localStorage).
- Checkout now lands on the order page (`?placed=1` thank-you banner) instead of a receipt panel that vanished on refresh.
- Product detail dialog (specs, delivery prices, weight, item code, quantity). Category lives in the URL (`?category=`). Shared header/footer in `components/StoreChrome.jsx`; config/cart/recent-orders helpers in `lib/storeConfig.js`. Decorative icons removed from the shop.

**Server**
- Each order has `buyerToken` (18 random bytes, base64url); old orders get one lazily (`ensureBuyerToken`). Public routes in `routes/storefront.js`: `GET /api/store/orders/:token`, `POST /orders/lookup` (generic 404, 10/min), `POST /orders/:token/messages` (10/min, 30 per order), `POST /orders/:token/confirm-receipt` (requires tracking, idempotent). The buyer view omits risk, IP, evidence and PayPal internals.
- Evidence: buyer confirmation → `delivery_confirmation` verified ("receipt confirmed by the buyer on the store order page", with IP/UA). Order-page messages (`channel: 'store'`) → `buyer_communication` verified. Plural "(s)" strings removed.
- Seller: Home "Needs your attention" lists buyers awaiting a reply (`orderSummary.awaitingReply`); order detail has "Buyer's order page", a "Order page (buyer sees it)" reply channel (default when the buyer is waiting), topic labels, and shows the buyer's confirmation.

**Production fixes found while testing**
- CSP blocked Google Fonts in production (Inter/Fraunces fell back to system fonts). Added `fonts.googleapis.com` / `fonts.gstatic.com`.
- `server/.env` had `PAYPAL_BASE_URL=https://sandbox.paypal.com` (website, not API) → OAuth "Client Authentication failed". Fixed the line (backup in the session scratchpad) and `config.js` now maps website hosts to `api-m.*` with a warning.
- `/api/auth/me` returns `200 {user:null}` when signed out, so buyer pages no longer log a 401 in the console.

**Verified 2026-11-11** (production mode, Express serving `client/dist`, separate MongoDB DB `proofpilot_e2e`, dropped afterwards): 55/55 API checks (checkout price tampering, token/lookup/abuse limits, no data leaks in the buyer view, message → early warning, tracking → estimate + carrier link, reply, confirm receipt → 100% pack, simulated dispute → Gemini draft in ~37s citing `POD` + `MSG`, win likelihood high, fake citation rejected, double submit blocked, metrics); Playwright (Edge) walkthrough at 1440px and 390px with no overflow and no console errors except a deliberate bad-link 404; real sandbox Orders v2 create (`201`, order `16R90728S1373153G`) with capture correctly refused before approval, PayPal buttons rendered. ESLint clean, Vite build clean.

**Open**
- `server/.env` still has `PAYPAL_MODE=mock` (left for the owner to decide); clear it to use the sandbox checkout.
- Buyers get no email; the order link is on the confirmation page and via lookup.
- A full sandbox capture needs a sandbox personal account to approve the payment in the PayPal popup (manual step).
