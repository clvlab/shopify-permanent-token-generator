/**
 * activate-locations.js
 *
 * Activates a new Shopify location for every active product variant
 * that has inventory tracking enabled ("shopify" tracking).
 *
 * Usage:
 *   SHOPIFY_STORE=my-store.myshopify.com \
 *   SHOPIFY_TOKEN=shpat_xxx \
 *   NEW_LOCATION_ID=gid://shopify/Location/123456789 \
 *   node activate-locations.js
 *
 * Required scopes: read_products, write_inventory
 */

import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const STORE       = process.env.SHOPIFY_STORE;        // e.g. my-store.myshopify.com
const TOKEN       = process.env.SHOPIFY_TOKEN;        // Admin API access token
const LOCATION_ID = process.env.NEW_LOCATION_ID;     // GID of the new location
const API_VERSION = "2025-01";

if (!STORE || !TOKEN || !LOCATION_ID) {
  console.error(
    "Missing env vars. Set SHOPIFY_STORE, SHOPIFY_TOKEN, and NEW_LOCATION_ID."
  );
  process.exit(1);
}

const ENDPOINT = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

// ─── GraphQL helpers ────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json.data;
}

// Respect Shopify's cost-based rate limit by sleeping when throttled.
async function gqlWithRetry(query, variables = {}, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await gql(query, variables);
    } catch (err) {
      const isThrottle =
        err.message.includes("THROTTLED") ||
        err.message.includes("Throttled");

      if (isThrottle && attempt < retries - 1) {
        const wait = 2000 * (attempt + 1);
        console.warn(`  ⚠ Rate limited – retrying in ${wait / 1000}s…`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Queries & Mutations ────────────────────────────────────────────────────

/** Fetch a page of active, tracked products (inventory_management = "shopify"). */
const PRODUCTS_QUERY = /* GraphQL */ `
  query getActiveTrackedProducts($cursor: String) {
    products(
      first: 50
      after: $cursor
      query: "status:active AND inventory_management:shopify"
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          variants(first: 100) {
            edges {
              node {
                id
                displayName
                inventoryItem {
                  id
                  tracked
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Activate an inventory item at the new location. */
const ACTIVATE_MUTATION = /* GraphQL */ `
  mutation activateInventory($inventoryItemId: ID!, $locationId: ID!) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
    ) {
      inventoryLevel {
        id
        quantities(names: ["available"]) {
          name
          quantity
        }
        location {
          name
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Main ───────────────────────────────────────────────────────────────────

async function fetchAllTrackedVariants() {
  const variants = [];
  let cursor = null;

  console.log("📦 Fetching active products with inventory tracking…\n");

  do {
    const data = await gqlWithRetry(PRODUCTS_QUERY, { cursor });
    const { edges, pageInfo } = data.products;

    for (const { node: product } of edges) {
      for (const { node: variant } of product.variants.edges) {
        if (variant.inventoryItem?.tracked) {
          variants.push({
            productTitle: product.title,
            variantName:  variant.displayName,
            inventoryItemId: variant.inventoryItem.id,
          });
        }
      }
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return variants;
}

async function activateVariant({ productTitle, variantName, inventoryItemId }) {
  const data = await gqlWithRetry(ACTIVATE_MUTATION, {
    inventoryItemId,
    locationId: LOCATION_ID,
  });

  const { inventoryLevel, userErrors } = data.inventoryActivate;

  if (userErrors?.length) {
    // "Already stocked at this location" is not a real error — skip it.
    const realErrors = userErrors.filter(
      (e) => !e.message.toLowerCase().includes("already stocked")
    );
    if (realErrors.length) {
      console.error(
        `  ✗ ${productTitle} / ${variantName}:`,
        realErrors.map((e) => e.message).join(", ")
      );
      return { ok: false };
    }
    console.log(`  ↩ ${productTitle} / ${variantName}: already active`);
    return { ok: true, skipped: true };
  }

  const qty =
    inventoryLevel?.quantities?.find((q) => q.name === "available")
      ?.quantity ?? 0;
  const loc = inventoryLevel?.location?.name ?? LOCATION_ID;
  console.log(
    `  ✓ ${productTitle} / ${variantName} → activated at "${loc}" (available: ${qty})`
  );
  return { ok: true };
}

async function main() {
  console.log(`🏪 Store    : ${STORE}`);
  console.log(`📍 Location : ${LOCATION_ID}`);
  console.log(`🔧 API      : ${API_VERSION}\n`);

  const variants = await fetchAllTrackedVariants();
  console.log(`Found ${variants.length} tracked variant(s) to process.\n`);

  if (variants.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let activated = 0, skipped = 0, failed = 0;

  for (const variant of variants) {
    const result = await activateVariant(variant);
    if (result.ok && result.skipped) skipped++;
    else if (result.ok)             activated++;
    else                            failed++;

    // Small delay to stay within Shopify's rate limits.
    await sleep(200);
  }

  console.log("\n─────────────────────────────");
  console.log(`✅ Activated : ${activated}`);
  console.log(`↩  Skipped   : ${skipped} (already active)`);
  console.log(`❌ Failed    : ${failed}`);
  console.log("─────────────────────────────");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
