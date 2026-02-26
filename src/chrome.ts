/**
 * Chrome browser resolution: launch, connect, and auto-discover.
 *
 * Supports three modes:
 * 1. `launch: true` — find and launch a local Chrome/Chromium in headless mode
 * 2. `endpoint: "ws://..."` — connect directly to a WebSocket debugger URL
 * 3. `endpoint: "http://..."` — auto-discover WS URL via /json/version
 *
 * @module chrome
 */

import puppeteer, { type Browser } from "puppeteer-core";

const WELL_KNOWN_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

/**
 * Detect the path of a locally installed Chrome or Chromium.
 * Checks well-known paths for the current OS, plus the CHROME_PATH env var.
 *
 * @internal Exported for testing.
 * @returns The path to the Chrome executable, or null if not found.
 */
export function detectChromePath(): string | null {
  // Explicit env override takes priority
  const envPath = Deno.env.get("CHROME_PATH");
  if (envPath) return envPath;

  const os = Deno.build.os === "windows" ? "win32" : Deno.build.os;
  const candidates = WELL_KNOWN_PATHS[os] ?? [];

  for (const candidate of candidates) {
    try {
      Deno.statSync(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Launch a local Chrome instance in headless mode.
 *
 * @param executablePath Explicit path to Chrome. If omitted, auto-detects.
 * @returns A connected Browser instance. The caller is responsible for closing it.
 */
export async function launchChrome(executablePath?: string): Promise<Browser> {
  const chromePath = executablePath ?? detectChromePath();
  if (!chromePath) {
    throw new Error(
      "Could not find Chrome or Chromium on this machine.\n" +
        "Install Chrome, or set the CHROME_PATH environment variable, " +
        "or pass executablePath in browser options.\n\n" +
        "Checked paths:\n" +
        (WELL_KNOWN_PATHS[Deno.build.os === "windows" ? "win32" : Deno.build.os] ?? [])
          .map((p) => `  - ${p}`)
          .join("\n"),
    );
  }

  return await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

/**
 * Resolve an endpoint string to a WebSocket debugger URL.
 *
 * - `ws://` or `wss://` → returned as-is
 * - `http://` or `https://` → fetches /json/version to discover the WS URL
 */
export async function resolveEndpoint(endpoint: string): Promise<string> {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    return endpoint;
  }

  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
    const url = `${base}/json/version`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(
        `Failed to connect to Chrome at ${url}.\n` +
          `Is Chrome running with --remote-debugging-port?\n` +
          `Original error: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Chrome endpoint returned HTTP ${response.status} for ${url}.`,
      );
    }

    const data = await response.json() as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error(
        `Chrome endpoint at ${url} did not return a webSocketDebuggerUrl.\n` +
          `Response: ${JSON.stringify(data)}`,
      );
    }

    return data.webSocketDebuggerUrl;
  }

  throw new Error(
    `Invalid Chrome endpoint: "${endpoint}".\n` +
      `Expected ws://, wss://, http://, or https:// URL.`,
  );
}

/**
 * Connect to a Chrome instance via WebSocket endpoint (with auto-discovery).
 */
export async function connectChrome(endpoint: string): Promise<Browser> {
  const wsEndpoint = await resolveEndpoint(endpoint);
  return await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
}
