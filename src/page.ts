/**
 * GlubeanBrowser and GlubeanPage — browser automation wrappers that integrate
 * with the Glubean test context.
 *
 * `GlubeanBrowser` manages the Chrome connection (returned by the plugin factory).
 * `GlubeanPage` wraps a single Puppeteer Page with auto-instrumentation:
 * - `ctx.trace()` for every `goto()` navigation
 * - `ctx.metric()` for page load and DOMContentLoaded timing
 * - `ctx.log()` / `ctx.warn()` for browser console output and uncaught errors
 * - `ctx.trace()` for in-page network requests (XHR, fetch) via CDP
 *
 * @module page
 */

import type { Browser, ElementHandle, Page } from "puppeteer-core";
import { attachNetworkTracer } from "./network.ts";
import { collectNavigationMetrics } from "./metrics.ts";

/**
 * Plugin configuration options.
 *
 * Use **one** of these connection modes:
 * - `launch: true` — auto-detect and launch local Chrome in headless mode
 * - `endpoint: "CHROME_ENDPOINT"` — var key resolving to a `ws://`, `http://`, or `https://` URL
 *
 * When `endpoint` resolves to `http://` / `https://`, the plugin auto-discovers
 * the WebSocket debugger URL via Chrome's `/json/version` endpoint.
 */
export type BrowserOptions = BrowserOptionsBase & (
  | { launch: true; executablePath?: string; endpoint?: never }
  | { endpoint: string; launch?: never; executablePath?: never }
);

/** Auto-screenshot behavior. */
export type ScreenshotMode = "off" | "on-failure" | "every-step";

interface BrowserOptionsBase {
  /**
   * Optional var key whose runtime value is prepended to relative URLs in `goto()`.
   * @example "APP_URL"
   */
  baseUrl?: string;
  /** Emit `ctx.trace()` for in-page network requests (XHR, fetch). Default: true. */
  networkTrace?: boolean;
  /** Emit `ctx.metric()` for navigation timing. Default: true. */
  metrics?: boolean;
  /** Forward browser console output to `ctx.log()`/`ctx.warn()`. Default: true. */
  consoleForward?: boolean;
  /**
   * Auto-screenshot behavior.
   * - `"off"` — no automatic screenshots
   * - `"on-failure"` — capture a screenshot when a step or test fails (default)
   * - `"every-step"` — capture after every goto/click/type AND on failure
   */
  screenshot?: ScreenshotMode;
  /** Directory for auto-screenshots. Default: `".glubean/screenshots"`. */
  screenshotDir?: string;
}

/**
 * Minimal subset of TestContext needed by the browser plugin.
 *
 * Defined here to avoid a hard import dependency on the SDK's internal types,
 * keeping the plugin compatible across SDK versions via structural typing.
 */
export interface BrowserTestContext {
  /** Test identifier used for namespacing screenshots. */
  testId?: string;
  trace(request: {
    name?: string;
    method: string;
    url: string;
    status: number;
    duration: number;
  }): void;
  metric(
    name: string,
    value: number,
    options?: { unit?: string; tags?: Record<string, string> },
  ): void;
  log(message: string, data?: unknown): void;
  warn(condition: boolean, message: string): void;
}

/**
 * Connected browser instance returned by the plugin.
 *
 * Call `newPage(ctx)` to create an instrumented page wired to the test context.
 *
 * @example
 * ```ts
 * const pg = await chrome.newPage(ctx);
 * await pg.goto("/dashboard");
 * await pg.close();
 * ```
 */
export class GlubeanBrowser {
  private readonly _getBrowser: () => Promise<Browser>;
  private readonly _baseUrl: string | undefined;
  private readonly _options: BrowserOptions;

  /** @internal — created by the plugin factory. */
  constructor(
    getBrowser: () => Promise<Browser>,
    baseUrl: string | undefined,
    options: BrowserOptions,
  ) {
    this._getBrowser = getBrowser;
    this._baseUrl = baseUrl;
    this._options = options;
  }

  /**
   * Create a new instrumented page wired to the given test context.
   *
   * Each call creates a fresh browser page. Remember to call `page.close()`
   * in your teardown (or use `test.extend()` with a lifecycle factory).
   */
  async newPage(ctx: BrowserTestContext): Promise<GlubeanPage> {
    const browser = await this._getBrowser();
    const rawPage = await browser.newPage();
    // Read testId lazily from the runtime global — the harness updates it
    // before each test runs, so reading at newPage() time is always fresh.
    // deno-lint-ignore no-explicit-any
    const runtimeTestId = (globalThis as any).__glubeanRuntime?.test?.id as
      | string
      | undefined;
    return GlubeanPage._create(
      rawPage,
      this._baseUrl,
      ctx,
      this._options,
      runtimeTestId,
    );
  }

  /** Disconnect from the browser without closing it. Useful for remote Chrome. */
  async disconnect(): Promise<void> {
    const browser = await this._getBrowser();
    browser.disconnect();
  }

  /** Close the browser and terminate the Chrome process. */
  async close(): Promise<void> {
    const browser = await this._getBrowser();
    await browser.close();
  }
}

/**
 * Instrumented browser page with auto-tracing, metrics, and console forwarding.
 *
 * Wraps a subset of Puppeteer's Page API. For advanced operations, use `.raw`.
 *
 * @example
 * ```ts
 * await page.goto("/login");
 * await page.type("#email", "user@test.com");
 * await page.click('button[type="submit"]');
 * const title = await page.title();
 * ```
 */
export class GlubeanPage {
  /** The underlying Puppeteer Page for advanced use cases. */
  readonly raw: Page;

  private readonly _baseUrl: string | undefined;
  private readonly _ctx: BrowserTestContext;
  private readonly _metricsEnabled: boolean;
  private readonly _screenshotMode: ScreenshotMode;
  private readonly _screenshotDir: string;
  private readonly _testId: string;
  private _stepCounter = 0;
  private _networkCleanup: (() => Promise<void>) | null = null;

  private constructor(
    page: Page,
    baseUrl: string | undefined,
    ctx: BrowserTestContext,
    metricsEnabled: boolean,
    screenshotMode: ScreenshotMode,
    screenshotDir: string,
    testId: string,
  ) {
    this.raw = page;
    this._baseUrl = baseUrl;
    this._ctx = ctx;
    this._metricsEnabled = metricsEnabled;
    this._screenshotMode = screenshotMode;
    this._screenshotDir = screenshotDir;
    this._testId = testId;
  }

  /** @internal */
  static async _create(
    page: Page,
    baseUrl: string | undefined,
    ctx: BrowserTestContext,
    options: BrowserOptions,
    runtimeTestId?: string,
  ): Promise<GlubeanPage> {
    const consoleForward = options.consoleForward ?? true;
    const networkTrace = options.networkTrace ?? true;
    const metricsEnabled = options.metrics ?? true;
    const screenshotMode = options.screenshot ?? "on-failure";
    const screenshotDir = options.screenshotDir ?? ".glubean/screenshots";
    const testId = runtimeTestId ?? ctx.testId ?? "unknown";

    const gp = new GlubeanPage(
      page,
      baseUrl,
      ctx,
      metricsEnabled,
      screenshotMode,
      screenshotDir,
      testId,
    );

    if (consoleForward) {
      page.on("console", (msg) => {
        const type = msg.type();
        const text = msg.text();
        if (type === "error") {
          ctx.warn(false, `[browser:console] ${text}`);
        } else {
          ctx.log(`[browser:${type}] ${text}`);
        }
      });

      page.on("pageerror", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.warn(false, `[browser:uncaught] ${msg}`);
      });
    }

    if (networkTrace) {
      gp._networkCleanup = await attachNetworkTracer(page, {
        trace: (t) => ctx.trace(t),
      });
    }

    return gp;
  }

  // ── Screenshot helpers ──────────────────────────────────────────────

  private _formatTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  }

  private _sanitizeLabel(label: string): string {
    return label.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  }

  private async _ensureDir(dir: string): Promise<void> {
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    }
  }

  private async _saveScreenshot(filename: string): Promise<string> {
    const dir = `${this._screenshotDir}/${this._sanitizeLabel(this._testId)}`;
    await this._ensureDir(dir);
    const path = `${dir}/${filename}`;
    // deno-lint-ignore no-explicit-any
    await this.raw.screenshot({ path, fullPage: true } as any);
    this._ctx.log(`[browser:screenshot] ${path}`);
    return path;
  }

  private async _captureStep(action: string): Promise<void> {
    if (this._screenshotMode !== "every-step") return;
    this._stepCounter++;
    const num = String(this._stepCounter).padStart(3, "0");
    const ts = this._formatTimestamp();
    await this._saveScreenshot(
      `${num}-${this._sanitizeLabel(action)}-${ts}.png`,
    );
  }

  private async _captureFailure(action: string): Promise<void> {
    if (this._screenshotMode === "off") return;
    this._stepCounter++;
    const num = String(this._stepCounter).padStart(3, "0");
    const ts = this._formatTimestamp();
    try {
      await this._saveScreenshot(
        `FAIL-${num}-${this._sanitizeLabel(action)}-${ts}.png`,
      );
    } catch {
      // best-effort — page may be in a broken state
    }
  }

  /**
   * Capture a screenshot for a test-level failure (e.g. assertion error).
   *
   * Call this in the fixture's catch block to get a final-state screenshot
   * when the test body throws.
   */
  async screenshotOnFailure(): Promise<void> {
    if (this._screenshotMode === "off") return;
    const ts = this._formatTimestamp();
    try {
      await this._saveScreenshot(`FAIL-final-${ts}.png`);
    } catch {
      // best-effort
    }
  }

  // ── Navigation & interaction ────────────────────────────────────────

  /**
   * Navigate to a URL. Relative paths are resolved against the configured `baseUrl`.
   *
   * Auto-emits a `ctx.trace()` event and (if enabled) Navigation Timing metrics.
   * Captures a screenshot on failure or after every step (depending on config).
   */
  async goto(
    url: string,
    options?: {
      waitUntil?:
        | "load"
        | "domcontentloaded"
        | "networkidle0"
        | "networkidle2";
    },
  ): Promise<void> {
    const resolvedUrl = this._resolveUrl(url);
    const start = Date.now();

    let response;
    try {
      response = await this.raw.goto(resolvedUrl, {
        waitUntil: options?.waitUntil ?? "load",
      });
    } catch (err) {
      await this._captureFailure(`goto-${url}`);
      throw err;
    }

    const duration = Date.now() - start;
    const status = response?.status() ?? 0;

    this._ctx.trace({
      name: `[browser] Navigate ${url}`,
      method: "GET",
      url: resolvedUrl,
      status,
      duration,
    });

    if (this._metricsEnabled) {
      await collectNavigationMetrics(
        this.raw,
        (name, value, opts) => this._ctx.metric(name, value, opts),
        resolvedUrl,
      );
    }

    await this._captureStep(`goto-${url}`);
  }

  /**
   * Click an element matching the selector. Waits for it to appear first.
   * Captures a screenshot on failure or after every step (depending on config).
   */
  async click(selector: string): Promise<void> {
    try {
      await this.raw.waitForSelector(selector);
      await this.raw.click(selector);
    } catch (err) {
      await this._captureFailure(`click-${selector}`);
      throw err;
    }
    await this._captureStep(`click-${selector}`);
  }

  /**
   * Type text into an element matching the selector. Waits for it to appear first.
   * Captures a screenshot on failure or after every step (depending on config).
   */
  async type(selector: string, text: string): Promise<void> {
    try {
      await this.raw.waitForSelector(selector);
      await this.raw.type(selector, text);
    } catch (err) {
      await this._captureFailure(`type-${selector}`);
      throw err;
    }
    await this._captureStep(`type-${selector}`);
  }

  /** Query a single element by selector. */
  async $(selector: string): Promise<ElementHandle | null> {
    return await this.raw.$(selector);
  }

  /** Query all elements by selector. */
  async $$(selector: string): Promise<ElementHandle[]> {
    return await this.raw.$$(selector);
  }

  /** Evaluate a function in the browser page context. */
  async evaluate<T>(
    fn: (...args: unknown[]) => T,
    ...args: unknown[]
  ): Promise<T> {
    // deno-lint-ignore no-explicit-any
    return await this.raw.evaluate(fn as any, ...args);
  }

  /** Take a screenshot. Returns the image as a Buffer or base64 string. */
  async screenshot(
    options?: { encoding?: "binary" | "base64"; fullPage?: boolean },
  ): Promise<string | Uint8Array> {
    return await this.raw.screenshot({
      encoding: options?.encoding ?? "binary",
      fullPage: options?.fullPage ?? false,
      // deno-lint-ignore no-explicit-any
    } as any);
  }

  /** Current page URL. */
  url(): string {
    return this.raw.url();
  }

  /** Current page title. */
  async title(): Promise<string> {
    return await this.raw.title();
  }

  /** Clean up: remove CDP listeners and close the page. */
  async close(): Promise<void> {
    if (this._networkCleanup) {
      await this._networkCleanup();
      this._networkCleanup = null;
    }
    try {
      await this.raw.close();
    } catch {
      // page may already be closed
    }
  }

  private _resolveUrl(url: string): string {
    if (!this._baseUrl) return url;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;

    const base = this._baseUrl.endsWith("/")
      ? this._baseUrl.slice(0, -1)
      : this._baseUrl;
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${base}${path}`;
  }
}
