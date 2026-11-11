# Graph Report - paypal-proof-pilot  (2026-11-11)

## Corpus Check
- Corpus is ~41,138 words - fits in a single context window. You may not need a graph.

## Summary
- 488 nodes · 1496 edges · 12 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Seller console UI
- Order and dispute lifecycle
- Persistence, auth and config
- Buyer storefront and order page
- Client build tooling
- Storefront API and risk scoring
- Root scripts and store
- AI analysis and evidence pack
- PayPal REST client
- Server package
- Render deploy config
- Agent activity feed

## God Nodes (most connected - your core abstractions)
1. `Icon()` - 50 edges
2. `api()` - 44 edges
3. `DisputeDetail()` - 29 edges
4. `Store` - 27 edges
5. `Button()` - 26 edges
6. `OrderDetail()` - 24 edges
7. `Loading()` - 21 edges
8. `ErrorState()` - 21 edges
9. `money()` - 21 edges
10. `useResource()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `send()` --calls--> `api()`  [EXTRACTED]
  client/src/pages/StoreOrder.jsx → client/src/lib/api.js
- `RequireAuth()` --calls--> `Loading()`  [EXTRACTED]
  client/src/App.jsx → client/src/components/ui.jsx
- `App()` --calls--> `DisputeDetail()`  [EXTRACTED]
  client/src/App.jsx → client/src/pages/DisputeDetail.jsx
- `App()` --calls--> `Disputes()`  [EXTRACTED]
  client/src/App.jsx → client/src/pages/Disputes.jsx
- `App()` --calls--> `Home()`  [EXTRACTED]
  client/src/App.jsx → client/src/pages/Home.jsx

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "Seller console UI"
Cohesion: 0.09
Nodes (79): EvidencePack(), Icon(), ICONS, AiBadge(), Alert(), Badge(), Button(), Card() (+71 more)

### Community 1 - "Order and dispute lifecycle"
Cohesion: 0.07
Nodes (77): RFC-5737, findProduct(), clients, emit(), logActivity(), deliverySchema, disputeSchema, messageSchema (+69 more)

### Community 2 - "Persistence, auth and config"
Cohesion: 0.07
Nodes (35): express, zod, config, env(), int(), paypalClientId, paypalSecret, resolveAi() (+27 more)

### Community 3 - "Buyer storefront and order page"
Cohesion: 0.09
Nodes (46): App(), RequireAuth(), AppShell(), NAV, BrandMark(), ART, ProductArt(), TINTS (+38 more)

### Community 4 - "Client build tooling"
Cohesion: 0.08
Nodes (35): dependencies, lucide-react@^0.468.0, react@^19.3.1, react-dom@^19.3.1, react-router-dom@^7.18.5, devDependencies, eslint@^10.14.0, @eslint/js@^10.0.1 (+27 more)

### Community 5 - "Storefront API and risk scoring"
Cohesion: 0.09
Nodes (28): CATALOG, catalogMedianPrice, SHIPPING_METHODS, STORE_POLICY, addBusinessDays(), buyerOrderView(), buyerWriteLimiter, CARRIER_TRACKING_URLS (+20 more)

### Community 6 - "Root scripts and store"
Cohesion: 0.09
Nodes (27): @anthropic-ai/sdk, cors, dotenv, express-rate-limit, @google/genai, helmet, mongodb, multer (+19 more)

### Community 7 - "AI analysis and evidence pack"
Cohesion: 0.13
Nodes (23): aiEnabled, analyzeDispute(), assessGaps(), buildDisputePrompt(), callClaude(), callGemini(), callModel(), describeError() (+15 more)

### Community 8 - "PayPal REST client"
Cohesion: 0.18
Nodes (19): addTracking(), captureOrder(), createOrder(), createWebhook(), getAccessToken(), getDispute(), getOrder(), listDisputes() (+11 more)

### Community 9 - "Server package"
Cohesion: 0.12
Nodes (16): author, description, engines, node, keywords, license, name, private (+8 more)

### Community 10 - "Render deploy config"
Cohesion: 0.15
Nodes (12): key, sync, value, services, buildCommand, envVars, healthCheckPath, name (+4 more)

### Community 11 - "Agent activity feed"
Cohesion: 0.43
Nodes (7): ActivityFeed(), dayLabel(), iconFor(), KIND_ICON, refPath(), shortAgo(), tidyDetail()

## Knowledge Gaps
- **1 isolated node(s):** `RFC-5737`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 117 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Store` connect `Persistence, auth and config` to `Order and dispute lifecycle`, `Storefront API and risk scoring`, `Root scripts and store`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `RFC-5737` to the rest of the system?**
  _1 weakly-connected nodes found - possible missing edges._
- **Should `Seller console UI` be split into smaller, more focused modules?**
  _Cohesion score 0.08878602987586787 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Seller console UI` to `Buyer storefront and order page`, `Agent activity feed`, `Client build tooling`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `Order and dispute lifecycle` be split into smaller, more focused modules?**
  _Cohesion score 0.06566347469220246 - nodes in this community are weakly interconnected._
- **Why does `api()` connect `Seller console UI` to `Buyer storefront and order page`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `Persistence, auth and config` be split into smaller, more focused modules?**
  _Cohesion score 0.06557377049180328 - nodes in this community are weakly interconnected._