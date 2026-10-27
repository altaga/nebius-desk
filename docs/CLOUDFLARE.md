# Cloudflare for Nebius Desk

## Isolation from other projects (e.g. HAC)

Reuse the **same Cloudflare account/API token** if you want — that is normal.
Do **not** attach Nebius Desk to another project's zone (e.g. `hedera.dpdns.org`).

| Mode | Hostname | Needs zone? |
|---|---|---|
| **Named tunnel (recommended)** | `https://&lt;tunnel-uuid&gt;.cfargotunnel.com` | No |
| Quick tunnel | `https://*.trycloudflare.com` (changes) | No |
| Custom domain (optional later) | your DNS | Yes (`CLOUDFLARE_ZONE_ID` + CNAME) |

## Jetson path

1. Create a **named** tunnel via API (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) — useful later when you attach a zone/hostname.
2. **Public URL today (no Cloudflare zone):** run a **quick tunnel** on millie → `http://127.0.0.1:8000` → `https://*.trycloudflare.com`.
   - `*.cfargotunnel.com` is a CNAME *target*, not a browsable API URL.
   - Deploy: `scripts/deploy_millie.sh` + `scripts/_millie_quick_tunnel.sh`
   - After restart, URL may change — sync with `scripts/sync_desk_url_from_millie.py` then redeploy/env upsert.
3. Put that public HTTPS URL in server-only `DESK_API_URL` (Vercel Sensitive).

## Local CLI hygiene (from HAC practice)

Prefer **local** wrangler, not global:

```bash
npx wrangler …
npm exec wrangler -- …
```

Tunnel runtime on the board is **`cloudflared`**, not wrangler.

## Vercel web (no public secrets)

- Browser → Next.js BFF (`/api/desk/*` + login Server Action)
- Server-only `DESK_API_URL` on Vercel (**Sensitive** / encrypted) → Jetson tunnel
- **Never** put tokens, passwords, or private URLs in `NEXT_PUBLIC_*`
- Sync: `python scripts/vercel_deploy_web.py` (uses `VERCEL_TOKEN` from `secrets.env`)
