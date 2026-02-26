/**
 * CDP Network domain listener for auto-tracing in-page requests.
 *
 * Intercepts XHR, fetch, and document requests inside the browser page and
 * emits them as Glubean trace events so they appear in the same timeline as
 * `ctx.http` calls.
 *
 * @module network
 */

import type { CDPSession, Page } from "puppeteer-core";

/** Callback shape matching `ctx.trace()`. */
export type TraceFn = (trace: {
  name?: string;
  method: string;
  url: string;
  status: number;
  duration: number;
}) => void;

const SKIP_PROTOCOLS = ["data:", "chrome-extension:", "devtools:", "blob:"];
const SKIP_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  ".css", ".map",
];

/** @internal Exported for testing. */
export function shouldSkip(url: string): boolean {
  for (const proto of SKIP_PROTOCOLS) {
    if (url.startsWith(proto)) return true;
  }
  try {
    const pathname = new URL(url).pathname;
    for (const ext of SKIP_EXTENSIONS) {
      if (pathname.endsWith(ext)) return true;
    }
  } catch {
    // malformed URL — don't skip
  }
  return false;
}

export interface NetworkTracerOptions {
  trace: TraceFn;
  /** Skip static assets and non-HTTP protocols. Default: true. */
  filterStatic?: boolean;
}

/**
 * Attach a CDP Network listener to the page that emits Glubean trace events
 * for every in-page network request.
 *
 * Returns a cleanup function that detaches the listener.
 */
export async function attachNetworkTracer(
  page: Page,
  options: NetworkTracerOptions,
): Promise<() => Promise<void>> {
  const { trace, filterStatic = true } = options;
  const cdp: CDPSession = await page.createCDPSession();
  await cdp.send("Network.enable");

  const pending = new Map<string, { method: string; url: string; startMs: number }>();

  const onRequestWillBeSent = (params: {
    requestId: string;
    request: { method: string; url: string };
    timestamp: number;
  }) => {
    pending.set(params.requestId, {
      method: params.request.method,
      url: params.request.url,
      startMs: params.timestamp * 1000,
    });
  };

  const onResponseReceived = (params: {
    requestId: string;
    response: { url: string; status: number };
    timestamp: number;
  }) => {
    const req = pending.get(params.requestId);
    if (!req) return;
    pending.delete(params.requestId);

    if (filterStatic && shouldSkip(req.url)) return;

    const duration = Math.round(params.timestamp * 1000 - req.startMs);
    trace({
      name: `[browser] ${req.method} ${shortPath(req.url)}`,
      method: req.method,
      url: req.url,
      status: params.response.status,
      duration,
    });
  };

  const onLoadingFailed = (params: { requestId: string }) => {
    pending.delete(params.requestId);
  };

  cdp.on("Network.requestWillBeSent", onRequestWillBeSent);
  cdp.on("Network.responseReceived", onResponseReceived);
  cdp.on("Network.loadingFailed", onLoadingFailed);

  return async () => {
    cdp.off("Network.requestWillBeSent", onRequestWillBeSent);
    cdp.off("Network.responseReceived", onResponseReceived);
    cdp.off("Network.loadingFailed", onLoadingFailed);
    try {
      await cdp.detach();
    } catch {
      // page may already be closed
    }
  };
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
