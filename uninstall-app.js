#!/usr/bin/env node

/**
 * Shopify App Uninstaller Tool
 *
 * Uninstalls your app from multiple Shopify stores using the API.
 *
 * Usage:
 *   1. Fill in your stores in the STORES array below, OR
 *   2. Pass a JSON file: node uninstall-app.js --file stores.json
 *   3. Dry run (no actual uninstall): node uninstall-app.js --dry-run
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// ─────────────────────────────────────────────
// CONFIGURATION — Edit this section
// ─────────────────────────────────────────────

const API_VERSION = "2025-01"; // Update if needed

/**
 * Add your stores here directly, or use --file flag (see below)
 * Each entry needs the myshopify domain and the stored OAuth access token
 */
const STORES = [
  // { shop: 'example-store.myshopify.com', token: 'shpua_xxxxxxxxxxxx' },
  // { shop: 'another-store.myshopify.com', token: 'shpua_yyyyyyyyyyyy' },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function log(msg) {
  console.log(msg);
}
function info(msg) {
  console.log(`  ${c("cyan", "›")} ${msg}`);
}
function success(msg) {
  console.log(`  ${c("green", "✔")} ${msg}`);
}
function warn(msg) {
  console.log(`  ${c("yellow", "⚠")} ${msg}`);
}
function error(msg) {
  console.log(`  ${c("red", "✖")} ${msg}`);
}

function banner() {
  log("");
  log(c("bold", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  log(c("bold", "   🛒  Shopify App Uninstaller"));
  log(c("bold", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  log("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// API CALL
// ─────────────────────────────────────────────

function deleteApiPermission(shop, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: shop,
      path: `/admin/api/${API_VERSION}/api_permissions/current.json`,
      method: "DELETE",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.end();
  });
}

// ─────────────────────────────────────────────
// UNINSTALL LOGIC
// ─────────────────────────────────────────────

async function uninstallFromStore(store, dryRun) {
  const { shop, token } = store;

  if (!shop || !token) {
    error(`Skipping entry — missing shop or token: ${JSON.stringify(store)}`);
    return { shop, status: "skipped", reason: "missing shop or token" };
  }

  if (dryRun) {
    warn(`[DRY RUN] Would uninstall from: ${c("bold", shop)}`);
    return { shop, status: "dry-run" };
  }

  try {
    info(`Uninstalling from ${c("bold", shop)} ...`);
    const { statusCode, body } = await deleteApiPermission(shop, token);

    if (statusCode === 200 || statusCode === 204) {
      success(`Uninstalled from ${c("green", shop)}`);
      return { shop, status: "success", statusCode };
    } else if (statusCode === 401) {
      error(
        `Unauthorized for ${shop} — token may be invalid or already revoked`,
      );
      return { shop, status: "failed", statusCode, reason: "unauthorized" };
    } else if (statusCode === 404) {
      warn(`App not found on ${shop} — may already be uninstalled`);
      return { shop, status: "not_found", statusCode };
    } else {
      error(`Unexpected response from ${shop}: HTTP ${statusCode}`);
      return { shop, status: "failed", statusCode, body };
    }
  } catch (err) {
    error(`Error for ${shop}: ${err.message}`);
    return { shop, status: "error", reason: err.message };
  }
}

// ─────────────────────────────────────────────
// RESULTS SUMMARY
// ─────────────────────────────────────────────

function printSummary(results) {
  log("");
  log(c("bold", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  log(c("bold", "   Summary"));
  log(c("bold", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));

  const succeeded = results.filter((r) => r.status === "success");
  const failed = results.filter(
    (r) => r.status === "failed" || r.status === "error",
  );
  const notFound = results.filter((r) => r.status === "not_found");
  const skipped = results.filter((r) => r.status === "skipped");
  const dryRun = results.filter((r) => r.status === "dry-run");

  log("");
  if (succeeded.length)
    log(`  ${c("green", `✔ Uninstalled:  ${succeeded.length}`)}`);
  if (failed.length) log(`  ${c("red", `✖ Failed:       ${failed.length}`)}`);
  if (notFound.length)
    log(`  ${c("yellow", `⚠ Not found:    ${notFound.length}`)}`);
  if (skipped.length) log(`  ${c("dim", `  Skipped:      ${skipped.length}`)}`);
  if (dryRun.length) log(`  ${c("cyan", `› Dry-run:      ${dryRun.length}`)}`);

  if (failed.length > 0) {
    log("");
    log(c("bold", "  Failed stores:"));
    failed.forEach((r) => {
      log(`    ${c("red", r.shop)} — ${r.reason || `HTTP ${r.statusCode}`}`);
    });
  }

  log("");

  // Write results to file
  const outputFile = path.join(process.cwd(), "uninstall-results.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  info(`Results saved to ${c("cyan", "uninstall-results.json")}`);
  log("");
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  banner();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const helpFlag = args.includes("--help") || args.includes("-h");

  if (helpFlag) {
    log("Usage:");
    log(
      "  node uninstall-app.js                      # Uses STORES array in script",
    );
    log(
      "  node uninstall-app.js --file stores.json   # Load stores from JSON file",
    );
    log(
      "  node uninstall-app.js --dry-run            # Preview without uninstalling",
    );
    log("");
    log("stores.json format:");
    log("  [");
    log('    { "shop": "store1.myshopify.com", "token": "shpua_xxx" },');
    log('    { "shop": "store2.myshopify.com", "token": "shpua_yyy" }');
    log("  ]");
    log("");
    process.exit(0);
  }

  // Load stores from file if provided
  let stores = [...STORES];

  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      error(
        "--file flag requires a path argument. Example: --file stores.json",
      );
      process.exit(1);
    }
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      error(`File not found: ${absPath}`);
      process.exit(1);
    }
    try {
      const raw = fs.readFileSync(absPath, "utf8");
      stores = JSON.parse(raw);
      info(`Loaded ${stores.length} store(s) from ${filePath}`);
    } catch (err) {
      error(`Failed to parse JSON file: ${err.message}`);
      process.exit(1);
    }
  }

  if (stores.length === 0) {
    warn("No stores configured.");
    warn(
      "Add stores to the STORES array in the script, or use: --file stores.json",
    );
    log("");
    process.exit(0);
  }

  if (dryRun) {
    log(
      c("yellow", "  ⚠  DRY RUN MODE — no stores will actually be uninstalled"),
    );
    log("");
  }

  info(`API version: ${c("cyan", API_VERSION)}`);
  info(`Stores to process: ${c("bold", stores.length)}`);
  log("");

  // Confirm before proceeding (skip in dry-run)
  if (!dryRun) {
    log(
      c(
        "yellow",
        `  ⚠  This will PERMANENTLY uninstall your app from ${stores.length} store(s).`,
      ),
    );
    log(c("yellow", "     Access tokens will be revoked immediately."));
    log("");
    log("  Press ENTER to continue, or Ctrl+C to abort...");
    await new Promise((resolve) => {
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", resolve);
      process.stdin.resume();
    });
    process.stdin.pause();
  }

  // Process each store with a small delay to avoid rate limits
  const results = [];
  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    log(c("dim", `  [${i + 1}/${stores.length}]`));
    const result = await uninstallFromStore(store, dryRun);
    results.push(result);
    if (i < stores.length - 1) await sleep(500); // 500ms between calls
  }

  printSummary(results);
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
