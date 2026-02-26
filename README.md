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

## License

MIT
