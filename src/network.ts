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

/** Default content-type prefixes to include in traces. */
const DEFAULT_INCLUDE = ["application/json", "text/html"];

/** @internal Exported for testing. */
export function shouldSkipProtocol(url: string): boolean {
  for (const proto of SKIP_PROTOCOLS) {
    if (url.startsWith(proto)) return true;
  }
  return false;
}

/** @internal Exported for testing. */
export function shouldInclude(
  contentType: string,
  include: string[],
): boolean {
  const ct = contentType.toLowerCase();
  for (const prefix of include) {
    if (ct.startsWith(prefix)) return true;
  }
  return false;
}

/** Filter predicate for network requests. */
export type NetworkFilter = (req: {
  url: string;
  contentType: string;
  status: number;
}) => boolean;

export interface NetworkTracerOptions {
  trace: TraceFn;
  /**
   * Content-type prefixes to include. Ignored when `filter` is provided.
   * @default ["application/json", "text/html"]
   */
  include?: string[];
  /** Custom predicate. Overrides `include` when provided. */
  filter?: NetworkFilter;
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
  const { trace, filter, include = DEFAULT_INCLUDE } = options;
  const cdp: CDPSession = await page.createCDPSession();
  await cdp.send("Network.enable");

  const pending = new Map<
    string,
    { method: string; url: string; startMs: number }
  >();

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
    response: { url: string; status: number; mimeType: string; headers: Record<string, string> };
    timestamp: number;
  }) => {
    const req = pending.get(params.requestId);
    if (!req) return;
    pending.delete(params.requestId);

    // Always skip non-HTTP protocols
    if (shouldSkipProtocol(req.url)) return;

    const contentType = params.response.mimeType || "";
    const status = params.response.status;

    // Apply filter: custom predicate > include list
    if (filter) {
      if (!filter({ url: req.url, contentType, status })) return;
    } else {
      if (!shouldInclude(contentType, include)) return;
    }

    const duration = Math.round(params.timestamp * 1000 - req.startMs);
    trace({
      name: `[browser] ${req.method} ${shortPath(req.url)}`,
      method: req.method,
      url: req.url,
      status,
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
