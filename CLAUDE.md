# ProofPilot: working rules

## Start every session here
1. Read `overview.md` first. It is the source of truth for what exists, why, and what is still open. The newest numbered section supersedes older ones where they conflict.
2. For questions about code structure ("where is X", "what calls Y"), query the graphify graph (`graphify-out/graph.json`, via `/graphify query ...`) before opening files. Only read the files the graph points to.
3. Then do the task.

## Finish every task here
1. Append a dated section to `overview.md` covering what changed, the key decisions, what was verified and what is still open. Keep it factual and short.
2. Refresh the graph with `/graphify . --update` (incremental: only changed files are re-extracted).

## Project facts that are easy to get wrong
- The shop name is **Shikimori Handmade Goods** (`MERCHANT_NAME` in `server/.env`). The seller product is **ProofPilot**. Never use PayPal's logo or wordmark as our brand.
- UI bar: PayPal account look and feel, at the polish level of `../workflow-Tracker-XYZON`. No decorative icons, live dots or loud colours that carry no information. Check desktop (1440px) and phone (390px).
- `node --watch` does not reload `server/.env`; touch `server/src/index.js` or restart after changing it.
- PayPal runs against the sandbox only (`PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`).
