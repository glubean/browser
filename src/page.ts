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
import {
  ActionabilityError,
  type ActionOptions,
  asActionablePage,
  waitForActionable,
} from "./actionability.ts";

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
  /** Default timeout (ms) for actionability checks on `click()`/`type()`. Default: 30 000. */
  actionTimeout?: number;
}

/**
 * Structured interaction record emitted by browser methods.
 *
 * Matches the `GlubeanAction` shape from `@glubean/sdk` via structural typing.
 */
export interface BrowserAction {
  category: string;
  target: string;
  duration: number;
  status: "ok" | "error" | "timeout";
  detail?: Record<string, unknown>;
}

/**
 * Structured event emitted for observations/artifacts (screenshots, console errors).
 *
 * Matches the `GlubeanEvent` shape from `@glubean/sdk` via structural typing.
 */
export interface BrowserEvent {
  type: string;
  data: Record<string, unknown>;
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
  action(a: BrowserAction): void;
  event(ev: BrowserEvent): void;
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
  private readonly _actionTimeout: number;
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
    actionTimeout: number,
  ) {
    this.raw = page;
    this._baseUrl = baseUrl;
    this._ctx = ctx;
    this._metricsEnabled = metricsEnabled;
    this._screenshotMode = screenshotMode;
    this._screenshotDir = screenshotDir;
    this._testId = testId;
    this._actionTimeout = actionTimeout;
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
    const actionTimeout = options.actionTimeout ?? 30_000;

    const gp = new GlubeanPage(
      page,
      baseUrl,
      ctx,
      metricsEnabled,
      screenshotMode,
      screenshotDir,
      testId,
      actionTimeout,
    );

    if (consoleForward) {
      page.on("console", (msg) => {
        const type = msg.type();
        const text = msg.text();
        if (type === "error") {
          ctx.event({
            type: "browser:console-error",
            data: { message: text, source: msg.location()?.url },
          });
          ctx.warn(false, `[browser:console] ${text}`);
        } else {
          ctx.log(`[browser:${type}] ${text}`);
        }
      });

      page.on("pageerror", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        ctx.event({
          type: "browser:uncaught-error",
          data: { message: msg, stack },
        });
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

  private async _saveScreenshot(filename: string, label: string): Promise<string> {
    const dir = `${this._screenshotDir}/${this._sanitizeLabel(this._testId)}`;
    await this._ensureDir(dir);
    const path = `${dir}/${filename}`;
    // deno-lint-ignore no-explicit-any
    await this.raw.screenshot({ path, fullPage: true } as any);
    this._ctx.event({
      type: "browser:screenshot",
      data: { path, label, fullPage: true },
    });
    return path;
  }

  private async _captureStep(action: string): Promise<void> {
    if (this._screenshotMode !== "every-step") return;
    this._stepCounter++;
    const num = String(this._stepCounter).padStart(3, "0");
    const ts = this._formatTimestamp();
    await this._saveScreenshot(
      `${num}-${this._sanitizeLabel(action)}-${ts}.png`,
      action,
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
        `FAIL:${action}`,
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
      await this._saveScreenshot(`FAIL-final-${ts}.png`, "FAIL:final");
    } catch {
      // best-effort
    }
  }

  // ── Auto-wait diagnostics ─────────────────────────────────────────

  private static readonly _AUTOWAIT_METRIC_THRESHOLD = 500;
  private static readonly _AUTOWAIT_WARN_THRESHOLD = 5_000;

  private _emitAutoWaitDiagnostics(
    action: string,
    selector: string,
    autoWaitMs: number,
  ): void {
    if (autoWaitMs > GlubeanPage._AUTOWAIT_WARN_THRESHOLD) {
      this._ctx.warn(
        false,
        `[browser] Auto-wait for ${action}("${selector}") took ${autoWaitMs}ms — ` +
          `consider checking why the element is slow to become actionable`,
      );
    }
    if (autoWaitMs > GlubeanPage._AUTOWAIT_METRIC_THRESHOLD) {
      this._ctx.metric("browser_actionability_wait_ms", autoWaitMs, {
        unit: "ms",
        tags: { selector, action },
      });
    }
  }

  // ── Navigation & interaction ────────────────────────────────────────

  /**
   * Navigate to a URL. Relative paths are resolved against the configured `baseUrl`.
   *
   * Emits a `browser:goto` action and (if enabled) Navigation Timing metrics.
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
      const duration = Date.now() - start;
      this._ctx.action({
        category: "browser:goto",
        target: url,
        duration,
        status: "error",
        detail: { url: resolvedUrl, error: String(err) },
      });
      await this._captureFailure(`goto-${url}`);
      throw err;
    }

    const duration = Date.now() - start;
    const httpStatus = response?.status() ?? 0;

    this._ctx.action({
      category: "browser:goto",
      target: url,
      duration,
      status: httpStatus >= 400 ? "error" : "ok",
      detail: { url: resolvedUrl, httpStatus },
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
   * Click an element matching the selector.
   *
   * Auto-waits for the element to be attached, visible, and enabled before
   * clicking. Use `{ force: true }` to skip actionability checks.
   */
  async click(selector: string, options?: ActionOptions): Promise<void> {
    const start = Date.now();
    try {
      await waitForActionable(asActionablePage(this.raw), selector, {
        timeout: options?.timeout ?? this._actionTimeout,
        force: options?.force,
      });
      const autoWaitMs = Date.now() - start;
      await this.raw.click(selector);
      const duration = Date.now() - start;

      this._ctx.action({
        category: "browser:click",
        target: selector,
        duration,
        status: "ok",
        detail: { autoWaitMs, force: options?.force ?? false },
      });
      this._emitAutoWaitDiagnostics("click", selector, autoWaitMs);
    } catch (err) {
      const duration = Date.now() - start;
      this._ctx.action({
        category: "browser:click",
        target: selector,
        duration,
        status: err instanceof ActionabilityError ? "timeout" : "error",
        detail: { error: String(err), force: options?.force ?? false },
      });
      await this._captureFailure(`click-${selector}`);
      throw err;
    }
    await this._captureStep(`click-${selector}`);
  }

  /**
   * Type text into an element matching the selector.
   *
   * Auto-waits for the element to be attached, visible, and enabled before
   * typing. Use `{ force: true }` to skip actionability checks.
   */
  async type(
    selector: string,
    text: string,
    options?: ActionOptions,
  ): Promise<void> {
    const start = Date.now();
    try {
      await waitForActionable(asActionablePage(this.raw), selector, {
        timeout: options?.timeout ?? this._actionTimeout,
        force: options?.force,
      });
      const autoWaitMs = Date.now() - start;
      await this.raw.type(selector, text);
      const duration = Date.now() - start;

      this._ctx.action({
        category: "browser:type",
        target: selector,
        duration,
        status: "ok",
        detail: { textLength: text.length, autoWaitMs, force: options?.force ?? false },
      });
      this._emitAutoWaitDiagnostics("type", selector, autoWaitMs);
    } catch (err) {
      const duration = Date.now() - start;
      this._ctx.action({
        category: "browser:type",
        target: selector,
        duration,
        status: err instanceof ActionabilityError ? "timeout" : "error",
        detail: { textLength: text.length, error: String(err) },
      });
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

  // ── Retry utility ─────────────────────────────────────────────────

  private static readonly _POLL_MS = 100;

  /**
   * Poll `fn` until `check(result)` returns true, or throw after `timeout` ms.
   * Used by all `waitFor*`, `textContent`, and `expect*` methods.
   */
  private async _retryUntil<T>(
    fn: () => Promise<T>,
    check: (val: T) => boolean,
    errorMsg: (lastVal: T) => string,
    options?: { timeout?: number },
  ): Promise<T> {
    const timeout = options?.timeout ?? 5_000;
    const start = Date.now();
    let lastVal: T | undefined;

    while (Date.now() - start < timeout) {
      try {
        lastVal = await fn();
        if (check(lastVal)) return lastVal;
      } catch {
        // element may not exist yet — retry
      }
      await new Promise((r) => setTimeout(r, GlubeanPage._POLL_MS));
    }

    // One final attempt
    try {
      lastVal = await fn();
      if (check(lastVal!)) return lastVal!;
    } catch {
      // fall through to error
    }

    throw new Error(errorMsg(lastVal as T));
  }

  // ── Phase 4: Navigation Auto-Wait ────────────────────────────────

  /**
   * Wait until the page URL matches `pattern` (string contains or RegExp test).
   *
   * @example
   * ```ts
   * await page.click('a[href="/dashboard"]');
   * await page.waitForURL('/dashboard');
   * ```
   */
  async waitForURL(
    pattern: string | RegExp,
    options?: { timeout?: number },
  ): Promise<void> {
    const matches = (url: string) =>
      typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);

    const start = Date.now();
    try {
      await this._retryUntil(
        () => Promise.resolve(this.raw.url()),
        matches,
        (lastUrl) =>
          `waitForURL: page URL "${lastUrl}" did not match ` +
          `"${pattern}" after ${options?.timeout ?? 5_000}ms`,
        { timeout: options?.timeout ?? this._actionTimeout },
      );
      this._ctx.action({
        category: "browser:wait",
        target: `URL matches ${String(pattern)}`,
        duration: Date.now() - start,
        status: "ok",
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:wait",
        target: `URL matches ${String(pattern)}`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Wait for an element to appear, then return its `textContent`.
   */
  async textContent(
    selector: string,
    options?: { timeout?: number },
  ): Promise<string | null> {
    const start = Date.now();
    const timeout = options?.timeout ?? this._actionTimeout;
    try {
      await this.raw.waitForSelector(selector, { timeout });
      // deno-lint-ignore no-explicit-any
      const result = await this.raw.$eval(selector, (el: any) => el.textContent);
      this._ctx.action({
        category: "browser:wait",
        target: `textContent("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
      });
      return result;
    } catch (err) {
      this._ctx.action({
        category: "browser:wait",
        target: `textContent("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Wait for an element to appear, then return its `innerText`.
   */
  async innerText(
    selector: string,
    options?: { timeout?: number },
  ): Promise<string> {
    const start = Date.now();
    const timeout = options?.timeout ?? this._actionTimeout;
    try {
      await this.raw.waitForSelector(selector, { timeout });
      // deno-lint-ignore no-explicit-any
      const result = await this.raw.$eval(selector, (el: any) => el.innerText);
      this._ctx.action({
        category: "browser:wait",
        target: `innerText("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
      });
      return result;
    } catch (err) {
      this._ctx.action({
        category: "browser:wait",
        target: `innerText("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Wait for an element to appear, then return the value of `attr`.
   */
  async getAttribute(
    selector: string,
    attr: string,
    options?: { timeout?: number },
  ): Promise<string | null> {
    const start = Date.now();
    const timeout = options?.timeout ?? this._actionTimeout;
    try {
      await this.raw.waitForSelector(selector, { timeout });
      const result = await this.raw.$eval(
        selector,
        // deno-lint-ignore no-explicit-any
        (el: any, a: string) => el.getAttribute(a),
        attr,
      );
      this._ctx.action({
        category: "browser:wait",
        target: `getAttribute("${selector}", "${attr}")`,
        duration: Date.now() - start,
        status: "ok",
      });
      return result;
    } catch (err) {
      this._ctx.action({
        category: "browser:wait",
        target: `getAttribute("${selector}", "${attr}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Wait for an input element to appear, then return its `.value`.
   */
  async inputValue(
    selector: string,
    options?: { timeout?: number },
  ): Promise<string> {
    const start = Date.now();
    const timeout = options?.timeout ?? this._actionTimeout;
    try {
      await this.raw.waitForSelector(selector, { timeout });
      // deno-lint-ignore no-explicit-any
      const result = await this.raw.$eval(selector, (el: any) => el.value ?? "");
      this._ctx.action({
        category: "browser:wait",
        target: `inputValue("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
      });
      return result;
    } catch (err) {
      this._ctx.action({
        category: "browser:wait",
        target: `inputValue("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Check whether an element is currently visible (non-zero box, not hidden).
   * Returns immediately — does not wait.
   */
  async isVisible(selector: string): Promise<boolean> {
    const handle = await this.raw.$(selector);
    if (!handle) return false;
    try {
      // deno-lint-ignore no-explicit-any
      return await handle.evaluate((el: any) => {
        // deno-lint-ignore no-explicit-any
        const style = (globalThis as any).getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Check whether an element is currently enabled (not disabled).
   * Returns immediately — does not wait.
   */
  async isEnabled(selector: string): Promise<boolean> {
    const handle = await this.raw.$(selector);
    if (!handle) return false;
    try {
      // deno-lint-ignore no-explicit-any
      return await handle.evaluate((el: any) => {
        if ("disabled" in el && !!el.disabled) return false;
        return el.getAttribute("aria-disabled") !== "true";
      });
    } finally {
      await handle.dispose();
    }
  }

  // ── Phase 5: Assertion Auto-Retry ────────────────────────────────

  /**
   * Assert that the page URL matches `pattern`. Retries until match or timeout.
   *
   * @example
   * ```ts
   * await page.click('button[type="submit"]');
   * await page.expectURL('/dashboard');
   * ```
   */
  async expectURL(
    pattern: string | RegExp,
    options?: { timeout?: number },
  ): Promise<void> {
    const matches = (url: string) =>
      typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);

    const start = Date.now();
    try {
      await this._retryUntil(
        () => Promise.resolve(this.raw.url()),
        matches,
        (lastUrl) =>
          `expectURL: page URL "${lastUrl}" did not match ` +
          `"${pattern}" after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectURL(${JSON.stringify(String(pattern))})`,
        duration: Date.now() - start,
        status: "ok",
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectURL(${JSON.stringify(String(pattern))})`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Assert that an element's text content matches `expected`. Retries until match or timeout.
   */
  async expectText(
    selector: string,
    expected: string | RegExp,
    options?: { timeout?: number },
  ): Promise<void> {
    const matches = (text: string | null) => {
      if (text === null) return false;
      return typeof expected === "string"
        ? text === expected
        : expected.test(text);
    };

    const start = Date.now();
    let lastVal: string | null = null;
    try {
      lastVal = await this._retryUntil(
        // deno-lint-ignore no-explicit-any
        () => this.raw.$eval(selector, (el: any) => el.textContent as string | null).catch(() => null),
        matches,
        (lv) =>
          `expectText("${selector}"): expected ${JSON.stringify(expected)} ` +
          `but received ${JSON.stringify(lv)} after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectText("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
        detail: { expected: String(expected), actual: lastVal },
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectText("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { expected: String(expected), actual: lastVal, error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Assert that an element is visible. Retries until visible or timeout.
   */
  async expectVisible(
    selector: string,
    options?: { timeout?: number },
  ): Promise<void> {
    const start = Date.now();
    try {
      await this._retryUntil(
        () => this.isVisible(selector),
        (visible) => visible === true,
        () =>
          `expectVisible("${selector}"): element was not visible ` +
          `after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectVisible("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectVisible("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Assert that an element is hidden or absent. Retries until hidden or timeout.
   */
  async expectHidden(
    selector: string,
    options?: { timeout?: number },
  ): Promise<void> {
    const start = Date.now();
    try {
      await this._retryUntil(
        () => this.isVisible(selector),
        (visible) => visible === false,
        () =>
          `expectHidden("${selector}"): element was still visible ` +
          `after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectHidden("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectHidden("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Assert that an element has an attribute matching `expected`. Retries until match or timeout.
   */
  async expectAttribute(
    selector: string,
    attr: string,
    expected: string | RegExp,
    options?: { timeout?: number },
  ): Promise<void> {
    const matches = (val: string | null) => {
      if (val === null) return false;
      return typeof expected === "string"
        ? val === expected
        : expected.test(val);
    };

    const start = Date.now();
    let lastVal: string | null = null;
    try {
      lastVal = await this._retryUntil(
        () =>
          this.raw.$eval(
            selector,
            // deno-lint-ignore no-explicit-any
            (el: any, a: string) => el.getAttribute(a) as string | null,
            attr,
          ).catch(() => null),
        matches,
        (lv) =>
          `expectAttribute("${selector}", "${attr}"): expected ${JSON.stringify(expected)} ` +
          `but received ${JSON.stringify(lv)} after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectAttribute("${selector}", "${attr}")`,
        duration: Date.now() - start,
        status: "ok",
        detail: { expected: String(expected), actual: lastVal },
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectAttribute("${selector}", "${attr}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { expected: String(expected), actual: lastVal, error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Assert that the number of elements matching `selector` equals `expected`. Retries until match or timeout.
   */
  async expectCount(
    selector: string,
    expected: number,
    options?: { timeout?: number },
  ): Promise<void> {
    const start = Date.now();
    let lastCount = 0;
    try {
      lastCount = await this._retryUntil(
        async () => (await this.raw.$$(selector)).length,
        (count) => count === expected,
        (lc) =>
          `expectCount("${selector}"): expected ${expected} elements ` +
          `but found ${lc} after ${options?.timeout ?? 5_000}ms`,
        options,
      );
      this._ctx.action({
        category: "browser:assert",
        target: `expectCount("${selector}")`,
        duration: Date.now() - start,
        status: "ok",
        detail: { expected, actual: lastCount },
      });
    } catch (err) {
      this._ctx.action({
        category: "browser:assert",
        target: `expectCount("${selector}")`,
        duration: Date.now() - start,
        status: "timeout",
        detail: { expected, actual: lastCount, error: String(err) },
      });
      throw err;
    }
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
