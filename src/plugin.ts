/**
 * Glubean browser plugin factory.
 *
 * Uses `definePlugin()` from the SDK to create a lazily-initialized browser
 * connection. Returns a `GlubeanBrowser` with a `newPage(ctx)` method that
 * creates fully instrumented pages wired to the test context.
 *
 * Supports three connection modes:
 * - `launch: true` — auto-detect and start local Chrome headless
 * - `endpoint` resolving to `ws://` — direct WebSocket connection
 * - `endpoint` resolving to `http://` — auto-discover WS URL via /json/version
 *
 * @module plugin
 */

import { definePlugin } from "@glubean/sdk/plugin";
import type { GlubeanRuntime } from "@glubean/sdk";
import type { Browser } from "puppeteer-core";
import { GlubeanBrowser, type BrowserOptions } from "./page.ts";
import { connectChrome, launchChrome } from "./chrome.ts";

/**
 * Create a Glubean browser plugin.
 *
 * @param options Plugin configuration.
 *
 * @example Launch mode — zero config, auto-detects local Chrome
 * ```ts
 * import { configure, test } from "@glubean/sdk";
 * import { browser } from "@glubean/browser";
 *
 * const { chrome } = configure({
 *   plugins: {
 *     chrome: browser({ launch: true }),
 *   },
 * });
 * ```
 *
 * @example Connect mode — remote Chrome or Docker
 * ```ts
 * const { chrome } = configure({
 *   plugins: {
 *     chrome: browser({ endpoint: "CHROME_ENDPOINT" }),
 *   },
 * });
 * // .env: CHROME_ENDPOINT=http://localhost:9222
 * //   or: CHROME_ENDPOINT=ws://localhost:9222/devtools/browser/...
 * ```
 *
 * @example Full example with test.extend()
 * ```ts
 * const myTest = test.extend({
 *   page: async (ctx, use) => {
 *     const pg = await chrome.newPage(ctx);
 *     try {
 *       await use(pg);
 *     } finally {
 *       await pg.close();
 *     }
 *   },
 * });
 *
 * export const homepage = myTest("homepage-loads", async (ctx) => {
 *   await ctx.page.goto("/");
 *   ctx.expect(await ctx.page.title()).toBe("My App");
 * });
 * ```
 */
export function browser(options: BrowserOptions) {
  return definePlugin((runtime: GlubeanRuntime): GlubeanBrowser => {
    const baseUrl = options.baseUrl
      ? runtime.vars[options.baseUrl] ?? undefined
      : undefined;

    let browserPromise: Promise<Browser> | null = null;

    function getBrowser(): Promise<Browser> {
      if (!browserPromise) {
        if ("launch" in options && options.launch) {
          browserPromise = launchChrome(options.executablePath);
        } else if ("endpoint" in options && options.endpoint) {
          const endpoint = runtime.requireVar(options.endpoint);
          browserPromise = connectChrome(endpoint);
        } else {
          throw new Error(
            'browser() requires either { launch: true } or { endpoint: "VAR_KEY" }.',
          );
        }
      }
      return browserPromise;
    }

    return new GlubeanBrowser(getBrowser, baseUrl, options);
  });
}
