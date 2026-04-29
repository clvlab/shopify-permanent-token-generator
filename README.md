## Generate a permanent token

- Install dependencies: Run `npm install`

- Edit the config: Update the shop, clientId, and clientSecret in the script.

- Set Redirect URI: In your Shopify Dev Dashboard, set the Redirect URI to http://localhost:3000/callback.

- Launch: Run `npm start` and follow the URL in your terminal.

Once you have your shpat_ token, you can use it in the headers of your API calls as X-Shopify-Access-Token.

## Uninstall the app from stores

Revokes the app's access token via `DELETE /admin/api/<version>/api_permissions/current.json`.

**This is destructive and irreversible** — tokens are revoked immediately.

**Provide stores** by editing the `STORES` array in `uninstall-app.js`, or via a JSON file:

```json
[
  { "shop": "store1.myshopify.com", "token": "shpua_xxx" },
  { "shop": "store2.myshopify.com", "token": "shpua_yyy" }
]
```

**Commands:**

```sh
npm run uninstall-app                        # Uses STORES array in script
npm run uninstall-app -- --file stores.json  # Load stores from JSON file
npm run uninstall-app:dry                    # Preview without uninstalling
node uninstall-app.js --help                 # Show usage
```

Results are saved to `uninstall-results.json` after each run.


## Inventory Location Activator

Activates a new Shopify location for every active product variant that has inventory tracking enabled.

## What it does

Iterates through all active products with Shopify-managed inventory and calls `inventoryActivate` for each variant at the specified location. Variants already stocked at the location are silently skipped.

## Requirements

- Node.js with ES module support
- Shopify Admin API token with `read_products` and `write_inventory` scopes

## Setup

```sh
npm install
cp .env.example .env
# edit .env with your values
```

## Usage

```sh
npm start
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `SHOPIFY_STORE` | Store domain, e.g. `my-store.myshopify.com` |
| `SHOPIFY_TOKEN` | Admin API access token (`shpat_…`) |
| `NEW_LOCATION_ID` | GID of the location to activate, e.g. `gid://shopify/Location/123456789` |

## Output

```
🏪 Store    : my-store.myshopify.com
📍 Location : gid://shopify/Location/123456789
🔧 API      : 2025-01

📦 Fetching active products with inventory tracking…

Found 42 tracked variant(s) to process.

  ✓ My Product / Default Title → activated at "Warehouse A" (available: 0)
  ↩ Another Product / Size M: already active
  ...

─────────────────────────────
✅ Activated : 38
↩  Skipped   : 4 (already active)
❌ Failed    : 0
─────────────────────────────
```
