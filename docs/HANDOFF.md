# Icy Customizer — Handoff

Custom product builder for the Icy Shopify store (wearicy.com). Production
system, not a prototype: real Shopify cart/order integration, real storage,
real production print files. Client: Manik.

- Repo: `github.com/kossman-designs-shopify/wearicy-customizer`
- Local: `~/customizer`
- Deploy: `https://wearicy-customizer.vercel.app`
- Store: `wearicy.myshopify.com`

## 1. Status

Committed and building: **Stages 1, 2, 3, 5.** Nothing has been executed yet —
every line is compile- and logic-verified but has never run, because there is
no database or object storage provisioned.

```
06d17af Stage 5: canvas editor, design session and upload pipeline
77aa830 Stage 3: theme app extension
3ecadec Stage 2: Shopify integration
85793f8 Stage 1: foundation
```

### Done

| Stage | What |
|---|---|
| 1 | Next.js 15 + TS + Tailwind, Drizzle schema, R2 storage layer, provider abstractions, print coordinate system |
| 2 | OAuth install, three Shopify signature schemes, webhook handlers, order association, admin GraphQL client |
| 3 | Theme app extension: CUSTOMIZE CTA on product + collection pages, cart guard |
| 5 | Konva canvas editor, design sessions, direct-to-R2 upload pipeline |

### Not started

| Stage | What | Blocked on |
|---|---|---|
| 4 | Admin app (product config, mockups, stickers, fonts, designs/orders) | Postgres + R2 |
| 6 | Background removal + AI generation endpoints, credit ledger | Provider API keys |
| 7 | Review screen, variant matrix, production render, cart add | Postgres + R2 |
| 8 | Order handoff, production records, session expiry, README/ARCHITECTURE, 38-step acceptance test | Everything above |

## 2. Methodology — why it was built this way

**Stage order follows dependency, not the customer journey.** Foundation
first, then the trust boundary (Shopify auth), then the storefront hook, then
the editor. The editor was deliberately built before the admin app because it
is the biggest and riskiest component and it can be run and looked at without
any backing services — whereas the admin app is pure CRUD that cannot be
verified without a database. Verifiable work before unverifiable work.

**Configuration over code.** No product, colour, size, print dimension,
mockup, sticker or font is hardcoded anywhere. Adding a customizable product
is a database row plus a metafield, never a deploy. This is a hard
requirement: Icy must run the system without a developer.

**Shopify stays authoritative.** Price, variant IDs, inventory and
availability are always read from Shopify at request time. The customizer
never computes or caches them. There is no second inventory system.

**The print coordinate system is the foundation of print accuracy.** Every
object stores centre-anchored geometry in *print pixels* — the physical grid
from `inches x dpi` (12x16in @ 300dpi = 3600x4800). The canvas multiplies by a
scale factor on render and divides on input; nothing screen-dependent is ever
written to the design. An object at x=1800 is the same physical position on a
phone, a 4K monitor, or at 200% browser zoom. Do not break this.

**Provider abstractions at every external boundary.** Background removal and
AI generation sit behind interfaces (`lib/providers/`) that report
`available: false` when unconfigured rather than faking success. Swapping
remove.bg for Replicate is a config change, not a refactor.

**No fake functionality, ever.** The original spec prohibits placeholder API
calls, simulated processing, fake progress, and `TODO` for core features. Code
that awaits credentials is fine; code that pretends to work is not. If
something cannot be done as envisioned, implement the closest production-safe
version and document the limitation.

**Failure is never total.** Background removal failing keeps the original
image. A server save failing keeps the local copy and says so. The theme
extension catches everything so a JS error degrades to normal Shopify
behaviour rather than a broken storefront.

**Build, don't just typecheck.** Two real bugs (module-scope env access, and
`node:crypto` in client code) passed `tsc` and only surfaced in `next build`.
Always run a full build before declaring a stage done.

## 3. Architecture

```
Storefront (wearicy.com)
  Theme app extension  -> CUSTOMIZE CTA, cart guard
  /apps/icy-customizer -> Shopify App Proxy -> Vercel /proxy
                                                 |
Vercel (Next.js 15, App Router)                  |
  /admin        embedded Shopify admin UI  (Stage 4)
  /proxy        customizer page + /proxy/api/*
  /api/auth     OAuth install
  /api/webhooks orders/create, orders/updated, app/uninstalled
       |                        |
  Postgres (Drizzle)      Cloudflare R2
  metadata only           images; production art private
```

### Key files

| Path | Role |
|---|---|
| `lib/design.ts` | **Read this first.** Coordinate system, object model, overflow detection, DPI quality, validation, design hash |
| `db/schema.ts` | Full relational schema |
| `lib/shopify/verify.ts` | OAuth / App Proxy / webhook signature verification — three different schemes |
| `lib/shopify/proxy-context.ts` | Storefront trust boundary; `logged_in_customer_id` comes from Shopify, not the browser |
| `lib/editor/use-editor.ts` | History, coordinate mapping, two-tier autosave |
| `lib/editor/reducer.ts` | Pure reducer — all design mutation goes through here, which is what makes undo reliable |
| `components/editor/CanvasStage.tsx` | Konva canvas; print-pixel <-> screen conversion |
| `extensions/icy-customizer/` | Theme app extension |

### Routing gotcha

Shopify maps `wearicy.com/apps/icy-customizer/*` -> `<app>/proxy/*`. Proxy API
routes therefore live at `app/proxy/api/*`, **not** `app/api/proxy/*`. The
client calls `${proxyBase}/api/...` where `proxyBase = /apps/icy-customizer`.

### Existing endpoints

```
GET   /api/health                      config + DB status, names missing env vars
GET   /api/auth                        install entry
GET   /api/auth/callback               OAuth, registers webhooks automatically
POST  /api/webhooks/{orders-create,orders-updated,app-uninstalled}
GET   /proxy                           customizer page
GET   /proxy/api/config                editor bootstrap (product + config + mockups + fonts)
POST  /proxy/api/session               create design session
GET   /proxy/api/session/[id]          load design
PATCH /proxy/api/session/[id]          autosave design JSON
GET   /proxy/api/stickers              artwork library
POST  /proxy/api/upload                presigned direct-to-R2 upload
```

Still to build: `/proxy/api/background-removal`, `/proxy/api/ai-generate`,
`/proxy/api/ai-credits`, `/proxy/api/render`, `/proxy/api/cart-validate`,
`/proxy/api/complete`.

## 4. Shopify configuration (done)

Partner Dashboard app, **custom distribution** to wearicy — *not* an
Admin "Develop apps" custom app, which cannot have an App Proxy or theme
extension.

- Client ID `7e6f543e2eecbbe30c2a3e3bcc47a40b`
- App URL `https://wearicy-customizer.vercel.app/admin`
- Redirect `https://wearicy-customizer.vercel.app/api/auth/callback`
- App Proxy `apps` / `icy-customizer` -> `.../proxy`
- 13 scopes (see `lib/shopify/oauth.ts`)
- Webhooks API version `2026-07`
- Product metafield `icy.customizable` (boolean) created, Storefront API access on

Webhooks are **not** registered in the dashboard — `registerWebhooks()` runs
idempotently during OAuth callback. Reinstalling the app subscribes all three.

Theme app extension is written but never deployed: needs `shopify app deploy`.

## 5. Blockers

1. **Postgres** — Vercel > Storage > Create Database > Postgres. Then
   `npx drizzle-kit push` creates every table.
2. **Cloudflare R2** — bucket `icy-customizer`, API token with Object Read &
   Write, public dev URL for mockups/stickers/previews. Production artwork
   stays private behind signed URLs.
3. **`.env.local`** — copy `.env.example`. Needs `SHOPIFY_API_SECRET`,
   `DATABASE_URL`, `ENCRYPTION_KEY` (32+ random chars, never change after
   install or stored tokens become undecryptable), R2 keys.
4. **Undecided:** background removal provider (remove.bg ~$0.20/image and
   reliable, vs Replicate rembg ~$0.002 and rougher on hair/fur) and AI
   provider (OpenAI gpt-image-1, native transparency, ~$0.02-0.19, vs
   Replicate flux-schnell ~$0.003 needing a background pass). Swappable later.

## 6. Environment quirks

- **Build in a scratch copy.** The Claude sandbox mount leaves `.next` and
  `.git/*.lock` undeletable. Build via:
  `tar` the source (minus `node_modules`/`.next`/`.git`) to `$HOME/icybuild`,
  symlink `node_modules`, run `next build` there.
- **Prisma was abandoned** for Drizzle: `binaries.prisma.sh` is blocked by the
  sandbox egress policy. Drizzle is also the better serverless fit.
- **`canvas` is aliased to `false`** in `next.config.ts` — Konva's Node build
  requires the native package, which will not compile on Vercel.
- Background processes do not survive between `device_bash` calls; anything
  long must finish inside one call (180s cap).
- `wearicy-customizer.vercel.app` and the GitHub API are unreachable from the
  sandbox, so deploy/health checks must be done in a browser.

## 7. Working preferences

Stage by stage with review between stages. Evan prefers browser-based setup
over terminal where possible, and wants the reasoning behind decisions, not
just the output. Correct him when a framing is wrong rather than going along
with it — an earlier claim that Stage 4 was "blocked" was really
"unverifiable", and he pushed back on it correctly.

## 8. Next action

Provision Postgres and R2, then **make it run**: create tables, install the app
for real, configure one test product with mockups, and open the customizer
against a live Icy product. That converts four stages of unexecuted code into
something demonstrably working, and surfaces bugs now rather than in Stage 8.

Then Stage 4 (admin) -> 6 (providers) -> 7 (review/cart) -> 8 (orders, docs,
acceptance test).
