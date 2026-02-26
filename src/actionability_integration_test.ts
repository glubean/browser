/**
 * Integration tests for actionability auto-waiting with a real browser.
 *
 * Uses testdata/server.ts to serve pages with controlled timing,
 * then verifies that GlubeanPage.click() / type() actually wait.
 *
 * Run: deno test src/actionability_integration_test.ts \
 *        --allow-run --allow-read --allow-net --allow-env --allow-write
 */

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "jsr:@std/assert";
import { detectChromePath, launchChrome } from "./chrome.ts";
import { GlubeanPage } from "./page.ts";
import type { BrowserOptions, BrowserTestContext } from "./page.ts";
import { ActionabilityError } from "./actionability.ts";
import type { Browser } from "puppeteer-core";
import { startTestServer } from "../testdata/server.ts";

const chromeAvailable = !!detectChromePath();

function makeCtx(): BrowserTestContext {
  return {
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

// ---------------------------------------------------------------------------
// click waits for delayed visibility
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: click waits for delayed-button visibility",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/delayed-button`);

      const start = Date.now();
      await page.click("#btn");
      const elapsed = Date.now() - start;

      assert(elapsed >= 400, `waited too short: ${elapsed}ms`);
      assert(elapsed < 10_000, `waited too long: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// type waits for disabled input to become enabled
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: type waits for disabled input",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/disabled-form`);

      const start = Date.now();
      await page.type("#email", "test@example.com");
      const elapsed = Date.now() - start;

      assert(elapsed >= 500, `waited too short: ${elapsed}ms`);
      assert(elapsed < 10_000, `waited too long: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Already-ready element returns fast
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: click on already-ready element returns fast",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/already-ready`);

      const start = Date.now();
      await page.click("#btn");
      const elapsed = Date.now() - start;

      assert(elapsed < 2000, `took too long for ready element: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Timeout throws ActionabilityError
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: click on never-visible throws ActionabilityError",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/never-visible`);

      const err = await assertRejects(
        () => page.click("#btn", { timeout: 2000 }),
      );
      assertInstanceOf(err, ActionabilityError);
      assertEquals(err.failedCheck, "visible");
      assertEquals(err.diagnostics.computedDisplay, "none");
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// force: true bypasses checks
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: force: true skips actionability checks",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      // Use delayed-button: element exists but is hidden for 600ms.
      // With force: true, we skip our actionability checks entirely.
      // Puppeteer itself may still throw for display:none (no clickable point),
      // but the key assertion is: no ActionabilityError is thrown.
      await page.goto(`${server!.url}/delayed-button`);

      const start = Date.now();
      try {
        await page.click("#btn", { force: true });
      } catch (err) {
        // Puppeteer may throw "not clickable" for display:none — that's fine.
        // What matters: it's NOT an ActionabilityError (we skipped our checks).
        assert(
          !(err instanceof ActionabilityError),
          "force: true should not throw ActionabilityError",
        );
      }
      const elapsed = Date.now() - start;
      // Should not have waited 600ms for visibility
      assert(elapsed < 1000, `force click waited too long: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// actionTimeout from config is respected
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: actionTimeout config is respected",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      { launch: true, actionTimeout: 1000 },
    );

    try {
      await page.goto(`${server!.url}/never-visible`);

      const start = Date.now();
      const err = await assertRejects(
        () => page.click("#btn"),
      );
      const elapsed = Date.now() - start;

      assertInstanceOf(err, ActionabilityError);
      assert(elapsed >= 800, `timed out too fast: ${elapsed}ms`);
      assert(elapsed < 5000, `took too long: ${elapsed}ms — config not respected`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Extended selector: aria/ — click waits for delayed visibility
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: click with aria/ selector waits for visibility",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/aria-button`);

      const start = Date.now();
      await page.click("aria/Submit form");
      const elapsed = Date.now() - start;

      assert(elapsed >= 400, `waited too short: ${elapsed}ms`);
      assert(elapsed < 10_000, `waited too long: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Extended selector: ::-p-text() — click waits for enabled
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: click with ::-p-text() selector waits for enabled",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/text-button`);

      const start = Date.now();
      await page.click("::-p-text(Continue)");
      const elapsed = Date.now() - start;

      assert(elapsed >= 400, `waited too short: ${elapsed}ms`);
      assert(elapsed < 10_000, `waited too long: ${elapsed}ms`);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Extended selector: aria/ — isVisible returns correct result
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: isVisible with aria/ selector works",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      makeCtx(),
      baseOpts,
    );

    try {
      await page.goto(`${server!.url}/already-ready`);
      const visible = await page.isVisible("aria/Ready");
      assertEquals(visible, true);

      await page.goto(`${server!.url}/never-visible`);
      const hidden = await page.isVisible("aria/Ghost");
      assertEquals(hidden, false);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test({
  name: "actionability: [cleanup] close browser and server",
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
