# @glubean/browser

Browser automation plugin for [Glubean](https://glubean.dev), powered by
[puppeteer-core](https://pptr.dev).

Auto-launches or connects to Chrome and provides instrumentation that Puppeteer
alone doesn't have:

- **Navigation tracing** — every `page.goto()` emits a `ctx.trace()` event
- **Network tracing** — all in-page XHR/fetch calls appear in the Glubean trace timeline
- **Performance metrics** — page load and DOMContentLoaded timing via `ctx.metric()`
- **Console forwarding** — browser `console.*` output and uncaught errors flow to `ctx.log()`/`ctx.warn()`

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

  // Glubean assertions
  ctx.expect(page.url()).toContain("/dashboard");
  ctx.expect(await page.title()).toBe("Dashboard");
});
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

Instrumented page wrapper.

| Method | Description |
|---|---|
| `goto(url, options?)` | Navigate with auto-trace and metrics |
| `click(selector)` | Wait for element + click |
| `type(selector, text)` | Wait for element + type |
| `$(selector)` | Query single element |
| `$$(selector)` | Query all elements |
| `evaluate(fn, ...args)` | Run function in page context |
| `screenshot(options?)` | Take screenshot |
| `url()` | Current page URL |
| `title()` | Current page title |
| `close()` | Clean up and close page |
| `raw` | Underlying Puppeteer `Page` for advanced use |

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
