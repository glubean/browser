/**
 * Integration tests for @glubean/browser.
 *
 * Requires a real Chrome/Chromium installation.
 * Skipped automatically when Chrome is not available.
 *
 * Run: deno test integration_test.ts --allow-run --allow-read --allow-net --allow-env
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { detectChromePath, launchChrome } from "./src/chrome.ts";
import { GlubeanPage } from "./src/page.ts";
import type { BrowserOptions, BrowserTestContext } from "./src/page.ts";
import type { Browser } from "puppeteer-core";

const chromeAvailable = !!detectChromePath();

function makeCtx() {
  const traces: Array<{
    name?: string;
    method: string;
    url: string;
    status: number;
    duration: number;
  }> = [];
  const metrics: Array<{
    name: string;
    value: number;
    options?: { unit?: string; tags?: Record<string, string> };
  }> = [];
  const logs: Array<{ message: string; data?: unknown }> = [];
  const warns: Array<{ condition: boolean; message: string }> = [];

  const ctx: BrowserTestContext = {
    trace: (t) => traces.push(t),
    metric: (name, value, options) => metrics.push({ name, value, options }),
    log: (message, data) => logs.push({ message, data }),
    warn: (condition, message) => warns.push({ condition, message }),
  };

  return { ctx, traces, metrics, logs, warns };
}

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await launchChrome();
  }
  return sharedBrowser;
}

const defaultOptions: BrowserOptions = { launch: true };

// ---------------------------------------------------------------------------
// Launch and navigate
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: launch Chrome and navigate to data URL",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx } = makeCtx();
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      ctx,
      defaultOptions,
    );

    try {
      await page.goto("data:text/html,<title>Hello</title><h1>World</h1>", {
        waitUntil: "load",
      });

      assertEquals(await page.title(), "Hello");
      assertStringIncludes(page.url(), "data:text/html");
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Auto-trace on goto
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: goto emits trace event",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx, traces } = makeCtx();
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      ctx,
      defaultOptions,
    );

    try {
      await page.goto("data:text/html,<h1>Trace</h1>");

      const nav = traces.find((t) => t.name?.includes("Navigate"));
      assertEquals(nav !== undefined, true, "Expected a navigation trace");
      assertEquals(nav!.method, "GET");
      assertEquals(nav!.status >= 0, true);
      assertEquals(nav!.duration >= 0, true);
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Console forwarding
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: console.log forwarded to ctx.log",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx, logs } = makeCtx();
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      ctx,
      defaultOptions,
    );

    try {
      await page.goto(
        'data:text/html,<script>console.log("glubean-test-msg")</script>',
      );

      await new Promise((r) => setTimeout(r, 500));

      const found = logs.some((l) => l.message.includes("glubean-test-msg"));
      assertEquals(
        found,
        true,
        `Expected log containing "glubean-test-msg", got: ${
          JSON.stringify(logs)
        }`,
      );
    } finally {
      await page.close();
    }
  },
});

// ---------------------------------------------------------------------------
// Network tracing (requires HTTP server)
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: in-page fetch traced via CDP network",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx, traces } = makeCtx();

    const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/api/ping") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        `<html><body><script>fetch("/api/ping").then(r => r.json())</script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    });

    const addr = server.addr as Deno.NetAddr;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      ctx,
      defaultOptions,
    );

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle0" });

      await new Promise((r) => setTimeout(r, 1000));

      const apiTrace = traces.find((t) => t.url.includes("/api/ping"));
      assertEquals(
        apiTrace !== undefined,
        true,
        `Expected /api/ping trace, got: ${traces.map((t) => t.url)}`,
      );
      assertEquals(apiTrace!.status, 200);
      assertEquals(apiTrace!.method, "GET");
    } finally {
      await page.close();
      await server.shutdown();
    }
  },
});

// ---------------------------------------------------------------------------
// Page close cleanup
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: page close without error",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx } = makeCtx();
    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const page = await GlubeanPage._create(
      rawPage,
      undefined,
      ctx,
      defaultOptions,
    );

    await page.goto("data:text/html,<h1>Close</h1>");
    await page.close();

    // Calling close again should not throw
    await page.close();
  },
});

// ---------------------------------------------------------------------------
// URL resolution with baseUrl
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: baseUrl resolves relative paths",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { ctx, traces } = makeCtx();

    const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
      return new Response("<html><head><title>Resolved</title></head></html>", {
        headers: { "content-type": "text/html" },
      });
    });

    const addr = server.addr as Deno.NetAddr;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const browser = await getBrowser();
    const rawPage = await browser.newPage();
    const options: BrowserOptions = { launch: true };
    const page = await GlubeanPage._create(rawPage, baseUrl, ctx, options);

    try {
      await page.goto("/dashboard");

      const nav = traces.find((t) => t.name?.includes("Navigate"));
      assertStringIncludes(nav!.url, `${baseUrl}/dashboard`);
      assertEquals(await page.title(), "Resolved");
    } finally {
      await page.close();
      await server.shutdown();
    }
  },
});

// ---------------------------------------------------------------------------
// Cleanup: close shared browser after all tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: [cleanup] close shared browser",
  ignore: !chromeAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
    }
  },
});
