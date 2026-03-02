# @glubean/browser

Browser automation plugin for [Glubean](https://glubean.dev), powered by
[puppeteer-core](https://pptr.dev).

## What `@glubean/browser` adds on top of Puppeteer

Puppeteer gives you a Chrome remote control. This plugin adds **two layers** on
top:

### Layer 1: Auto-observability — every action is traced, timed, and captured

You write zero instrumentation code. Everything flows into Glubean's trace
timeline automatically.

| What happens | Puppeteer | @glubean/browser |
|---|---|---|
| You navigate to `/login` | Nothing logged | Trace emitted with URL, status, duration |
| Page fetches `/api/auth` via XHR | Nothing logged | Trace emitted via CDP — same timeline as your test |
| Page takes 3.2s to load | Unknown | `page_load_ms` and `dom_content_loaded_ms` metrics emitted |
| `console.error("oops")` fires in-page | Silent unless you listen | Forwarded to test log + event |
| Test fails | You get a stack trace | You get a stack trace **+ automatic screenshot** |

### Layer 2: DX — the APIs Puppeteer still doesn't have

Puppeteer v21+ introduced the Locator API with auto-waiting for `click()`,
`fill()`, `hover()`, and `scroll()`. This plugin uses Locators internally — so
you get auto-waiting for free. But Puppeteer still has no assertion layer, no
navigation helpers, and no `type()` on Locators.

**Auto-retrying assertions** (Puppeteer has none — even with Locators):
```ts
await page.expectText("h1", "Welcome");     // retries until match or 5s timeout
await page.expectURL("/dashboard");          // retries until URL matches
await page.expectVisible(".modal");          // retries until visible
await page.expectCount(".item", 3);          // retries until count matches
```

**Navigation helpers** (Puppeteer still requires `$eval` + manual polling):
```ts
const text = await page.textContent("h1");   // waits for element, returns textContent
const val  = await page.inputValue("#email"); // waits for input, returns .value
await page.waitForURL("/dashboard");          // polls URL until match
```

**One-liner patterns**:
```ts
await page.clickAndNavigate("a.link");       // Promise.all([waitForNavigation, click]) + metrics
await page.type("#email", "user@test.com");  // auto-wait + type (Locator has fill(), not type())
await page.upload("#file", "./resume.pdf");  // wait for input + uploadFile()
```

**Full Puppeteer passthrough** — no `page.raw` needed:
```ts
await page.setViewport({ width: 1280, height: 720 });  // Puppeteer method, works directly
await page.keyboard.press("Enter");                     // Puppeteer method, works directly
```

### Before / After

**Modern Puppeteer (v21+ Locator API) + Jest:**
```ts
const browser = await puppeteer.launch();
const page = await browser.newPage();
try {
  await page.goto("http://localhost:3000/login");

  // v21+ Locator API — auto-waits for element
  await page.locator("#email").fill("user@test.com");
  await page.locator("#password").fill("secret");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.locator('button[type="submit"]').click(),
  ]);

  // manual URL check — no retry
  expect(page.url()).toContain("/dashboard");

  // manual text check — no retry, no helper
  const text = await page.$eval("h1", (el) => el.textContent);
  expect(text).toBe("Welcome back");
} catch (err) {
  await page.screenshot({ path: "fail.png", fullPage: true });
  throw err;
} finally {
  await browser.close();
}
// traces? metrics? network logs? console errors? — all DIY
```

**@glubean/browser:**
```ts
export const login = browserTest("login", async ({ page }) => {
  await page.goto("/login");
  await page.type("#email", "user@test.com");
  await page.type("#password", "secret");
  await page.clickAndNavigate('button[type="submit"]');
  await page.expectURL("/dashboard");
  await page.expectText("h1", "Welcome back");
});
// traces ✓  metrics ✓  network logs ✓  console errors ✓  screenshots ✓
// page.raw is the native Puppeteer Page — zero capability loss
```

Even with the Locator API, Puppeteer still requires manual lifecycle
management (`launch`/`close`), `Promise.all` for navigation, one-shot
assertions, manual screenshots, and zero observability.

### The difference at a glance

| | Puppeteer (v21+ Locators) | @glubean/browser |
|---|---|---|
| **Auto-wait** | Locator `click()` / `fill()` — yes | Same (uses Locators internally) |
| **Assertions** | `expect()` runs once, no retry | `expectText()` / `expectURL()` auto-retry until stable |
| **Observability** | DIY — you write every trace, metric, screenshot | Automatic — zero-config tracing, metrics, screenshots |
| **Navigation helpers** | `$eval()` + manual polling | `textContent()`, `waitForURL()`, `clickAndNavigate()` |
| **Network visibility** | None unless you add CDP listeners | All XHR/fetch traced via CDP automatically |
| **Failure debugging** | Stack trace only | Stack trace + screenshot + last action trace |
| **Lifecycle** | Manual `launch()` / `close()` / try-finally | Managed by `browserTest()` fixture |
| **Ecosystem** | Standalone | Plugs into Glubean — same timeline as API tests |

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

### With puppeteer-extra plugins

Pass a puppeteer-extra instance to use community plugins (Stealth, Recaptcha,
Adblocker, etc.) — all auto-tracing and assertions still work.

```ts
import { configure } from "@glubean/sdk";
import { browser } from "@glubean/browser";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";

puppeteerExtra.use(StealthPlugin());
puppeteerExtra.use(RecaptchaPlugin({ provider: { id: "2captcha", token: "TOKEN" } }));

export const { chrome } = configure({
  plugins: {
    chrome: browser({ launch: true, puppeteer: puppeteerExtra }),
  },
});
```

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

## What Gets Auto-Traced

When you run a test, Glubean's `.glubean/traces/` will contain:

```
[browser] Navigate /login          GET  http://localhost:3000/login      200  450ms
[browser] POST /api/auth/login     POST http://localhost:3000/api/auth   200   80ms
[browser] Navigate /dashboard      GET  http://localhost:3000/dashboard  200  320ms
```

Navigation traces and in-page network requests appear in the same timeline as
`ctx.http` API calls — a unified view of frontend + backend behavior.

## API

### `browser(options)`

Creates a Glubean plugin factory. Use with `configure({ plugins })`.

**Launch mode:**

| Option           | Type      | Default  | Description                         |
| ---------------- | --------- | -------- | ----------------------------------- |
| `launch`         | `true`    | required | Auto-detect and launch local Chrome |
| `executablePath` | `string`  | —        | Explicit path to Chrome binary      |
| `baseUrl`        | `string`  | —        | Var key for base URL                |
| `networkTrace`   | `boolean` | `true`   | Trace in-page network requests      |
| `metrics`        | `boolean` | `true`   | Collect navigation timing metrics   |
| `consoleForward` | `boolean` | `true`   | Forward browser console output      |

**Connect mode:**

| Option           | Type      | Default  | Description                                   |
| ---------------- | --------- | -------- | --------------------------------------------- |
| `endpoint`       | `string`  | required | Var key resolving to `ws://` or `http://` URL |
| `baseUrl`        | `string`  | —        | Var key for base URL                          |
| `networkTrace`   | `boolean` | `true`   | Trace in-page network requests                |
| `metrics`        | `boolean` | `true`   | Collect navigation timing metrics             |
| `consoleForward` | `boolean` | `true`   | Forward browser console output                |

### `GlubeanBrowser`

Returned by the plugin. Manages the Chrome connection.

| Method         | Description                                           |
| -------------- | ----------------------------------------------------- |
| `newPage(ctx)` | Create an instrumented page wired to the test context |
| `disconnect()` | Disconnect from Chrome (rarely needed)                |

### `GlubeanPage` (returned as `InstrumentedPage`)

Instrumented page wrapper. All Puppeteer `Page` methods/properties are available
directly via Proxy passthrough — enhanced methods take priority, everything else
falls through to the underlying Puppeteer Page.

Methods marked with **+** are enhanced versions of Puppeteer originals; methods
marked with **NEW** have no Puppeteer equivalent.

**Core (Puppeteer-compatible, enhanced with observability)**

|       | Method                           | Description                                       |
| ----- | -------------------------------- | ------------------------------------------------- |
| **+** | `goto(url, options?)`            | Navigate — enhanced with auto-trace and metrics                   |
| **+** | `click(selector, options?)`      | Click — enhanced with actionability auto-wait                     |
| **+** | `clickAndNavigate(selector, options?)` | Click + waitForNavigation in one call (trace + metrics)    |
| **+** | `type(selector, text, options?)` | Type — enhanced with actionability auto-wait                      |
| **+** | `locator(selector)`              | Returns a WrappedLocator with chain methods and auto-tracing      |
|       | `$(selector)`                    | Query single element (passthrough)                                |
|       | `$$(selector)`                   | Query all elements (passthrough)                  |
|       | `evaluate(fn, ...args)`          | Run function in page context (passthrough)        |
|       | `screenshot(options?)`           | Take screenshot (passthrough)                     |
|       | `url()`                          | Current page URL (passthrough)                    |
|       | `title()`                        | Current page title (passthrough)                  |
|       | `close()`                        | Clean up and close page                           |
|       | `raw`                            | Underlying Puppeteer `Page` for direct CDP access |

**Navigation Auto-Wait (NEW — Puppeteer doesn't have these)**

| Method                                   | Description                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `waitForURL(pattern, options?)`          | Poll until URL matches (does **not** wait for page load — see note above) |
| `textContent(selector, options?)`        | Wait for element, return `.textContent`                                   |
| `innerText(selector, options?)`          | Wait for element, return `.innerText`                                     |
| `getAttribute(selector, attr, options?)` | Wait for element, return attribute value                                  |
| `inputValue(selector, options?)`         | Wait for input element, return `.value`                                   |
| `isVisible(selector)`                    | Instant check — is element visible?                                       |
| `isEnabled(selector)`                    | Instant check — is element enabled?                                       |

**Assertion Auto-Retry (NEW — Puppeteer has no assertion layer)**

| Method                                                | Description                                       |
| ----------------------------------------------------- | ------------------------------------------------- |
| `expectURL(pattern, options?)`                        | Retry until URL matches (default 5s timeout)      |
| `expectText(selector, expected, options?)`            | Retry until text content matches string or RegExp |
| `expectVisible(selector, options?)`                   | Retry until element is visible                    |
| `expectHidden(selector, options?)`                    | Retry until element is hidden or absent           |
| `expectAttribute(selector, attr, expected, options?)` | Retry until attribute matches                     |
| `expectCount(selector, expected, options?)`           | Retry until element count matches                 |

## Deployment

### Local development

```ts
browser({ launch: true });
```

No setup needed if Chrome is installed.

### CI (GitHub Actions)

```ts
browser({ launch: true, executablePath: "/usr/bin/chromium" });
```

GitHub Actions runners have Chromium pre-installed.

### Docker / Self-hosted

Pre-install Chromium in your image:

```dockerfile
RUN apt-get update && apt-get install -y chromium
```

```ts
browser({ launch: true, executablePath: "/usr/bin/chromium" });
```

### Chrome-as-a-Service

```ts
browser({ endpoint: "CHROME_ENDPOINT" });
```

```env
CHROME_ENDPOINT=https://chrome.browserless.io?token=...
```

## Why Not Just Use Playwright?

You absolutely can. Playwright is the best browser automation framework out
there.

But here's the thing: most teams don't _only_ test browsers.

You have API endpoints to verify. You have staging and production environments
to monitor. You have data-driven scenarios to parametrize. You have secrets to
manage. You have traces to review when something breaks at 2am.

Playwright gives you a world-class browser. Glubean gives you the world around
it.

|                           | Playwright                 | Glubean + @glubean/browser                    |
| ------------------------- | -------------------------- | --------------------------------------------- |
| Browser testing           | Best-in-class              | Covers ~80% of app testing needs              |
| API testing               | Separate `request` context | First-class `ctx.http` with full tracing      |
| API + browser in one test | Two paradigms              | Same `ctx`, same trace timeline               |
| Environment management    | Manual env vars            | `ctx.vars`, `ctx.secrets`, env switching      |
| Data-driven testing       | DIY loops                  | `fromCsv`, `fromYaml` built-in                |
| Observability             | Trace Viewer (local file)  | Traces + metrics + dashboards (local & cloud) |
| Run in production         | Not designed for it        | Built for it — monitoring, not just testing   |
| MCP / AI agent testing    | No                         | Yes — protocol and behavior-level             |

### When to use Playwright instead

- Cross-browser testing is a hard requirement (Firefox, Safari)
- Complex DOM interactions: drag-drop, canvas, Figma-style editors, rich text
- Visual regression testing with pixel-level comparison
- Your entire test suite is browser-only and you need deep Locator chains

### When to use Glubean

- You test APIs **and** browser flows in the same suite
- You run the same tests across dev / staging / prod
- You want traces and metrics, not just pass/fail
- You're already on Puppeteer and want better DX without switching ecosystems
- You need to test MCP servers or AI agent behavior alongside browser flows

### The honest trade-off

`@glubean/browser` covers ~80% of what apps need to test in a browser — login
flows, form submissions, navigation, CRUD operations, data display. For the
remaining 20% (cross-browser, canvas, drag-drop, visual regression), Playwright
is the right tool.

Glubean's edge is **everything around the browser** — and browser is just one
plugin among many (HTTP, MCP, and more to come).

If all you test is a browser, use Playwright. If your system has APIs, services,
and a browser — use Glubean.

## License

MIT
