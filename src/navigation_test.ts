/**
 * Integration tests for Phase 4 (Navigation Auto-Wait) and Phase 5 (Assertion Auto-Retry).
 *
 * Uses testdata/server.ts endpoints with controlled timing to verify that
 * the new GlubeanPage methods properly poll and retry.
 *
 * Run: deno test src/navigation_test.ts \
 *        --allow-run --allow-read --allow-net --allow-env --allow-write
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { detectChromePath, launchChrome } from "./chrome.ts";
import { GlubeanPage } from "./page.ts";
import type { BrowserOptions, BrowserTestContext } from "./page.ts";
import type { Browser } from "puppeteer-core";
import { startTestServer } from "../testdata/server.ts";

const chromeAvailable = !!detectChromePath();

function makeCtx(): BrowserTestContext {
  return {
    action: () => {},
    event: () => {},
    trace: () => {},
    metric: () => {},
    log: () => {},
    warn: () => {},
  };
}

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await launchChrome();
  }
  return sharedBrowser;
}

const server = chromeAvailable ? startTestServer() : null;
const baseOpts: BrowserOptions = { launch: true };

async function makePage(
  overrides?: { actionTimeout?: number },
): Promise<GlubeanPage> {
  const browser = await getBrowser();
  const rawPage = await browser.newPage();
  const opts: BrowserOptions = overrides
    ? { launch: true, ...overrides }
    : baseOpts;
  return await GlubeanPage._create(
    rawPage,
    undefined,
    makeCtx(),
    opts,
  );
}

// ===========================================================================
// Phase 4: Navigation Auto-Wait
// ===========================================================================

Deno.test({
  name: "navigation: waitForURL polls until URL matches",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/spa-navigation`);
      await page.click("#link", { force: true });

      const start = Date.now();
      await page.waitForURL("/dashboard");
      const elapsed = Date.now() - start;

      assert(elapsed >= 300, `returned too fast: ${elapsed}ms`);
      assert(elapsed < 10_000, `waited too long: ${elapsed}ms`);
      assert(page.url().includes("/dashboard"));
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "navigation: waitForURL times out with clear error",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/already-ready`);

      const err = await assertRejects(() =>
        page.waitForURL("/never-gonna-match", { timeout: 1500 })
      );
      assert(
        (err as Error).message.includes("waitForURL"),
        `Error message should mention waitForURL: ${(err as Error).message}`,
      );
      assert(
        (err as Error).message.includes("never-gonna-match"),
        `Error message should include pattern`,
      );
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "navigation: textContent waits for element",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-text`);
      const text = await page.textContent("#heading");
      assertEquals(text, "Loading...");
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "navigation: getAttribute waits and returns attribute",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-attr`);
      const val = await page.getAttribute("#box", "data-status");
      assertEquals(val, "pending");
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "navigation: isVisible / isEnabled return correct boolean",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/already-ready`);
      assertEquals(await page.isVisible("#btn"), true);
      assertEquals(await page.isEnabled("#btn"), true);

      await page.goto(`${server!.url}/never-visible`);
      assertEquals(await page.isVisible("#btn"), false);
    } finally {
      await page.close();
    }
  },
});

// ===========================================================================
// Phase 5: Assertion Auto-Retry
// ===========================================================================

Deno.test({
  name: "assertion: expectURL succeeds when URL eventually matches",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/spa-navigation`);
      await page.click("#link", { force: true });

      const start = Date.now();
      await page.expectURL("/dashboard");
      const elapsed = Date.now() - start;

      assert(elapsed >= 300, `asserted too fast: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectText retries until text matches",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-text`);

      const start = Date.now();
      await page.expectText("#heading", "Welcome");
      const elapsed = Date.now() - start;

      assert(elapsed >= 400, `asserted too fast: ${elapsed}ms`);
      assert(elapsed < 10_000, `asserted too slow: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectText times out with last-value error",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-text`);

      const err = await assertRejects(() =>
        page.expectText("#heading", "Nonexistent", { timeout: 1500 })
      );
      assert(
        (err as Error).message.includes("expectText"),
        `Error message should mention expectText`,
      );
      assert(
        (err as Error).message.includes("Nonexistent"),
        `Error message should include expected value`,
      );
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectVisible succeeds when element appears",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-button`);

      const start = Date.now();
      await page.expectVisible("#btn");
      const elapsed = Date.now() - start;

      assert(elapsed >= 400, `asserted too fast: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectHidden succeeds when element disappears",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/hide-after-delay`);

      assertEquals(await page.isVisible("#el"), true);

      const start = Date.now();
      await page.expectHidden("#el");
      const elapsed = Date.now() - start;

      assert(elapsed >= 300, `asserted too fast: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectAttribute retries until match",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-attr`);

      const start = Date.now();
      await page.expectAttribute("#box", "data-status", "ready");
      const elapsed = Date.now() - start;

      assert(elapsed >= 300, `asserted too fast: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

Deno.test({
  name: "assertion: expectCount retries until count matches",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const page = await makePage();
    try {
      await page.goto(`${server!.url}/delayed-list`);

      const start = Date.now();
      await page.expectCount("li", 3);
      const elapsed = Date.now() - start;

      assert(elapsed >= 300, `asserted too fast: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ===========================================================================
// Cleanup
// ===========================================================================

Deno.test({
  name: "navigation: [cleanup] close browser and server",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
    }
    if (server) {
      await server.close();
    }
  },
});
