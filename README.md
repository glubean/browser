# @glubean/browser

Browser automation plugin for [Glubean](https://glubean.dev), powered by
[puppeteer-core](https://pptr.dev).

This plugin **wraps Puppeteer** and adds two layers of capabilities that
Puppeteer alone doesn't provide:

### Layer 1: Glubean Observability

Every browser action is automatically wired into the Glubean test context:

- **Navigation tracing** — every `page.goto()` emits a `ctx.trace()` event
- **Network tracing** — all in-page XHR/fetch calls appear in the Glubean trace timeline
- **Performance metrics** — page load and DOMContentLoaded timing via `ctx.metric()`
- **Console forwarding** — browser `console.*` output and uncaught errors flow to `ctx.log()`/`ctx.warn()`
- **Auto-screenshots** — capture on failure or at every step (`screenshot: "on-failure" | "every-step"`)

### Layer 2: DX Enhancements (things Puppeteer doesn't have)

Puppeteer is a low-level Chrome DevTools Protocol library. It gives you raw
power, but leaves convenience to you. This plugin adds the DX features that
Puppeteer users often wish they had — and that Playwright users take for granted:

- **Action auto-waiting** — `click()` and `type()` automatically wait for the element to be attached, visible, and enabled before interacting (Puppeteer requires manual `waitForSelector`)
- **Navigation auto-wait** — `waitForURL()`, `textContent()`, `getAttribute()`, etc. (Puppeteer has no equivalent — you'd write `page.evaluate()` and manual polling)
- **Assertion auto-retry** — `expectText()`, `expectVisible()`, `expectCount()`, etc. poll until a condition matches or timeout (Puppeteer has no assertion layer at all)
- **Diagnostic errors** — timeout errors include the selector, what check failed, computed styles, and a `force: true` hint (Puppeteer just says "timeout")

All of these are **new APIs on `GlubeanPage`**, not Puppeteer native. You can
always drop down to the raw Puppeteer `Page` via `page.raw` when you need full
CDP-level control.

No bundled browser binary. No framework conflicts. Just Chrome automation that
plugs into Glubean's test context.

## Install

```ts
// deno.json
{
  "imports": {
    "@glubean/browser": "jsr:@glubean/browser@^0.1.0"
  }
}
```

## Quick Start

### Launch mode (zero config)

The simplest way to get started. No environment variables, no Docker, no manual
Chrome setup. The plugin finds and launches your local Chrome automatically.

```ts
// tests/configure.ts
import { configure } from "@glubean/sdk";
import { browser } from "@glubean/browser";

export const { chrome } = configure({
  plugins: {
    chrome: browser({ launch: true }),
  },
});
```

That's it. The plugin auto-detects Chrome on your machine:

- **macOS**: `/Applications/Google Chrome.app/...`
- **Linux**: `/usr/bin/google-chrome`, `/usr/bin/chromium`
- **Docker**: `/usr/bin/chromium` (pre-installed in image)
- **Override**: set `CHROME_PATH` env var for a custom path

### Connect mode (remote Chrome)

For CI with a Chrome sidecar, Docker, or Chrome-as-a-Service.

```ts
export const { chrome } = configure({
  plugins: {
    chrome: browser({
      endpoint: "CHROME_ENDPOINT",
      baseUrl: "APP_URL",
    }),
  },
});
```

The `endpoint` var supports two URL formats:

```env
# HTTP — auto-discovers WebSocket URL via /json/version (recommended)
CHROME_ENDPOINT=http://localhost:9222

# WebSocket — direct connection (no discovery step)
CHROME_ENDPOINT=ws://localhost:9222/devtools/browser/abc123...
```

HTTP auto-discovery is recommended because the WebSocket URL changes every time
Chrome restarts. The HTTP address stays the same.

## Per-Test Pages with `test.extend()`

```ts
// tests/base.ts
import { test } from "@glubean/sdk";
import { chrome } from "./configure.ts";

export const browserTest = test.extend({
  page: async (ctx, use) => {
    const pg = await chrome.newPage(ctx);
    try {
      await use(pg);
    } finally {
      await pg.close();
    }
  },
});
```

## Write Tests

```ts
// tests/login.test.ts
import { browserTest } from "./base.ts";

export const loginFlow = browserTest("login-flow", async (ctx) => {
  const { page } = ctx;

  await page.goto("/login");
  await page.type("#email", "user@test.com");
  await page.type("#password", ctx.secrets.require("TEST_PASSWORD"));
  await page.click('button[type="submit"]');

  // Auto-retrying assertions — no manual waits needed
  await page.expectURL("/dashboard");
  await page.expectText("h1", "Welcome back");
});
```

## Auto-Waiting: Before & After

Puppeteer is intentionally low-level — it doesn't auto-wait for elements,
doesn't retry assertions, and doesn't have convenience methods for reading DOM
properties. This plugin adds all of that, inspired by Playwright's API design
but implemented on top of Puppeteer's CDP foundation.

### Before (raw Puppeteer — what you'd write without this plugin)

```ts
// Puppeteer doesn't auto-wait. You must call waitForSelector yourself.
await page.waitForSelector("#submit");
await page.click("#submit");

// Puppeteer has no textContent() method. You use evaluate().
const text = await page.evaluate(
  () => document.querySelector("h1")?.textContent ?? "",
);
if (text !== "Welcome") throw new Error(`Expected "Welcome", got "${text}"`);

// Puppeteer has no URL polling. You check once and hope.
if (!page.url().includes("/dashboard")) {
  throw new Error("Not on dashboard");
}

// Puppeteer has no assertion retry. You write your own polling loop.
let items;
const start = Date.now();
while (Date.now() - start < 5000) {
  items = await page.$$(".item");
  if (items.length === 3) break;
  await new Promise((r) => setTimeout(r, 100));
}
if (items.length !== 3) throw new Error(`Expected 3 items, got ${items.length}`);
```

### After (with @glubean/browser — all methods below are new, not Puppeteer native)

```ts
// click() is enhanced: auto-waits for attached + visible + enabled
await page.click("#submit");

// expectText() is new: retries until text matches (5s default timeout)
await page.expectText("h1", "Welcome");

// expectURL() is new: retries until URL matches
await page.expectURL("/dashboard");

// expectCount() is new: retries until element count matches
await page.expectCount(".item", 3);
```

### What about `waitForNavigation`?

Puppeteer's `page.waitForNavigation({ waitUntil: "load" })` waits for the
browser's `load` event — meaning all resources (scripts, images, stylesheets)
have finished loading. This is a fundamentally different guarantee.

Our `waitForURL(pattern)` only polls the URL until it matches. It does **not**
guarantee the page has finished loading. For SPA client-side routing (where the
URL changes via `history.pushState` without a full page load), `waitForURL` is
the right tool. For full-page navigations where you need the page to be fully
loaded, use `page.raw.waitForNavigation()`:

```ts
// SPA route change — no full page load, just URL change
await page.click("a.spa-link");
await page.waitForURL("/dashboard");      // polls URL, fast
await page.expectText("h1", "Dashboard"); // then verify content arrived

// Full page navigation — need resources loaded
await Promise.all([
  page.raw.waitForNavigation({ waitUntil: "load" }),
  page.raw.click("a.external-link"),
]);
```

The `page.raw` escape hatch is always available for Puppeteer-native behavior.

**What's enhanced vs what's new:**

| Method | Puppeteer has it? | What we changed |
|---|---|---|
| `click(selector)` | Yes, but no auto-wait | Added actionability checks (attached + visible + enabled) before clicking |
| `type(selector, text)` | Yes, but no auto-wait | Same — waits for element to be actionable |
| `waitForURL()` | **No** | New. Polls URL until match. Different from Puppeteer's `waitForNavigation` which waits for the `load` event |
| `textContent()` | **No** | New. Puppeteer requires `$eval(sel, el => el.textContent)` |
| `innerText()` | **No** | New. Same pattern |
| `getAttribute()` | **No** | New. Puppeteer requires `$eval` |
| `inputValue()` | **No** | New. Puppeteer requires `$eval` |
| `isVisible()` | **No** | New. Puppeteer requires `evaluate` + `getComputedStyle` |
| `isEnabled()` | **No** | New. Puppeteer requires `evaluate` |
| `expectURL()` | **No** | New. Auto-retrying assertion |
| `expectText()` | **No** | New. Auto-retrying assertion |
| `expectVisible()` | **No** | New. Auto-retrying assertion |
| `expectHidden()` | **No** | New. Auto-retrying assertion |
| `expectAttribute()` | **No** | New. Auto-retrying assertion |
| `expectCount()` | **No** | New. Auto-retrying assertion |

Need raw Puppeteer? It's always there via `page.raw`:

```ts
// Full CDP-level access when you need it
await page.raw.waitForNavigation({ waitUntil: "networkidle0" });
await page.raw.evaluate(() => window.scrollTo(0, 999));
```

## What Gets Auto-Traced

When you run a test, Glubean's `.glubean/traces/` will contain:

```
[browser] Navigate /login          GET  http://localhost:3000/login      200  450ms
[browser] POST /api/auth/login     POST http://localhost:3000/api/auth   200   80ms
[browser] Navigate /dashboard      GET  http://localhost:3000/dashboard  200  320ms
```

Navigation traces and in-page network requests appear in the same timeline
as `ctx.http` API calls — a unified view of frontend + backend behavior.

## API

### `browser(options)`

Creates a Glubean plugin factory. Use with `configure({ plugins })`.

**Launch mode:**

| Option | Type | Default | Description |
|---|---|---|---|
| `launch` | `true` | required | Auto-detect and launch local Chrome |
| `executablePath` | `string` | — | Explicit path to Chrome binary |
| `baseUrl` | `string` | — | Var key for base URL |
| `networkTrace` | `boolean` | `true` | Trace in-page network requests |
| `metrics` | `boolean` | `true` | Collect navigation timing metrics |
| `consoleForward` | `boolean` | `true` | Forward browser console output |

**Connect mode:**

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | required | Var key resolving to `ws://` or `http://` URL |
| `baseUrl` | `string` | — | Var key for base URL |
| `networkTrace` | `boolean` | `true` | Trace in-page network requests |
| `metrics` | `boolean` | `true` | Collect navigation timing metrics |
| `consoleForward` | `boolean` | `true` | Forward browser console output |

### `GlubeanBrowser`

Returned by the plugin. Manages the Chrome connection.

| Method | Description |
|---|---|
| `newPage(ctx)` | Create an instrumented page wired to the test context |
| `disconnect()` | Disconnect from Chrome (rarely needed) |

### `GlubeanPage`

Instrumented page wrapper. Methods marked with **+** are enhanced versions of
Puppeteer originals; methods marked with **NEW** have no Puppeteer equivalent.

**Core (Puppeteer-compatible, enhanced with observability)**

| | Method | Description |
|---|---|---|
| **+** | `goto(url, options?)` | Navigate — enhanced with auto-trace and metrics |
| **+** | `click(selector, options?)` | Click — enhanced with actionability auto-wait |
| **+** | `type(selector, text, options?)` | Type — enhanced with actionability auto-wait |
| | `$(selector)` | Query single element (passthrough) |
| | `$$(selector)` | Query all elements (passthrough) |
| | `evaluate(fn, ...args)` | Run function in page context (passthrough) |
| | `screenshot(options?)` | Take screenshot (passthrough) |
| | `url()` | Current page URL (passthrough) |
| | `title()` | Current page title (passthrough) |
| | `close()` | Clean up and close page |
| | `raw` | Underlying Puppeteer `Page` for direct CDP access |

**Navigation Auto-Wait (NEW — Puppeteer doesn't have these)**

| Method | Description |
|---|---|
| `waitForURL(pattern, options?)` | Poll until URL matches (does **not** wait for page load — see note above) |
| `textContent(selector, options?)` | Wait for element, return `.textContent` |
| `innerText(selector, options?)` | Wait for element, return `.innerText` |
| `getAttribute(selector, attr, options?)` | Wait for element, return attribute value |
| `inputValue(selector, options?)` | Wait for input element, return `.value` |
| `isVisible(selector)` | Instant check — is element visible? |
| `isEnabled(selector)` | Instant check — is element enabled? |

**Assertion Auto-Retry (NEW — Puppeteer has no assertion layer)**

| Method | Description |
|---|---|
| `expectURL(pattern, options?)` | Retry until URL matches (default 5s timeout) |
| `expectText(selector, expected, options?)` | Retry until text content matches string or RegExp |
| `expectVisible(selector, options?)` | Retry until element is visible |
| `expectHidden(selector, options?)` | Retry until element is hidden or absent |
| `expectAttribute(selector, attr, expected, options?)` | Retry until attribute matches |
| `expectCount(selector, expected, options?)` | Retry until element count matches |

## Deployment

### Local development

```ts
browser({ launch: true })
```

No setup needed if Chrome is installed.

### CI (GitHub Actions)

```ts
browser({ launch: true, executablePath: "/usr/bin/chromium" })
```

GitHub Actions runners have Chromium pre-installed.

### Docker / Self-hosted

Pre-install Chromium in your image:

```dockerfile
RUN apt-get update && apt-get install -y chromium
```

```ts
browser({ launch: true, executablePath: "/usr/bin/chromium" })
```

### Chrome-as-a-Service

```ts
browser({ endpoint: "CHROME_ENDPOINT" })
```

```env
CHROME_ENDPOINT=https://chrome.browserless.io?token=...
```

## Why Not Just Use Playwright?

You absolutely can. Playwright is the best browser automation framework out there.

But here's the thing: most teams don't *only* test browsers.

You have API endpoints to verify. You have staging and production environments to
monitor. You have data-driven scenarios to parametrize. You have secrets to manage.
You have traces to review when something breaks at 2am.

Playwright gives you a world-class browser. Glubean gives you the world around it.

| | Playwright | Glubean + @glubean/browser |
|---|---|---|
| Browser testing | Best-in-class | Good — auto-waiting, auto-trace, screenshots |
| API testing | Separate `request` context | First-class `ctx.http` with full tracing |
| API + browser in one test | Two paradigms | Same `ctx`, same trace timeline |
| Environment management | Manual env vars | `ctx.vars`, `ctx.secrets`, env switching |
| Data-driven testing | DIY loops | `fromCsv`, `fromYaml` built-in |
| Observability | Trace Viewer (local file) | Traces + metrics + dashboards (local & cloud) |
| Run in production | Not designed for it | Built for it — monitoring, not just testing |
| MCP / AI agent testing | No | Yes — protocol and behavior-level |

### When to use Playwright instead

- Cross-browser testing is a hard requirement (Firefox, Safari)
- You're testing a complex SPA with deep DOM interactions (drag-drop, canvas, rich text editors)
- Your entire test suite is browser-only and you need Locator chains

### When to use Glubean

- You test APIs **and** browser flows in the same suite
- You run the same tests across dev / staging / prod
- You want traces and metrics, not just pass/fail
- You're already on Puppeteer and want better DX without switching ecosystems
- You need to test MCP servers or AI agent behavior alongside browser flows

### The honest trade-off

Playwright wins on **browser DX** — Locators, cross-browser, codegen, visual regression.

Glubean wins on **everything else** — and browser is just one plugin among many
(HTTP, MCP, and more to come).

If all you test is a browser, use Playwright. If your system has APIs, services,
and a browser — use Glubean.

## License

MIT
