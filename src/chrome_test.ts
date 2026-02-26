import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { resolveEndpoint } from "./chrome.ts";

// ---------------------------------------------------------------------------
// resolveEndpoint
// ---------------------------------------------------------------------------

Deno.test("resolveEndpoint: ws:// passthrough", async () => {
  const ws = "ws://localhost:9222/devtools/browser/abc123";
  assertEquals(await resolveEndpoint(ws), ws);
});

Deno.test("resolveEndpoint: wss:// passthrough", async () => {
  const wss = "wss://chrome.example.com/devtools/browser/abc123";
  assertEquals(await resolveEndpoint(wss), wss);
});

Deno.test("resolveEndpoint: http:// auto-discovers WS URL", async () => {
  const expectedWs = "ws://127.0.0.1:9222/devtools/browser/fake-id";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assertEquals(url, "http://localhost:9222/json/version");
    return Promise.resolve(
      new Response(JSON.stringify({ webSocketDebuggerUrl: expectedWs }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  try {
    const result = await resolveEndpoint("http://localhost:9222");
    assertEquals(result, expectedWs);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveEndpoint: http:// strips trailing slash", async () => {
  const originalFetch = globalThis.fetch;
  let fetchedUrl = "";

  globalThis.fetch = (input: string | URL | Request) => {
    fetchedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(
      new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://x" }), {
        status: 200,
      }),
    );
  };

  try {
    await resolveEndpoint("http://localhost:9222/");
    assertEquals(fetchedUrl, "http://localhost:9222/json/version");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveEndpoint: http:// fetch failure gives clear error", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = () => {
    return Promise.reject(new Error("Connection refused"));
  };

  try {
    const err = await assertRejects(() => resolveEndpoint("http://localhost:9222"));
    assertStringIncludes((err as Error).message, "Failed to connect to Chrome");
    assertStringIncludes((err as Error).message, "--remote-debugging-port");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveEndpoint: http:// non-200 response", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = () => {
    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  try {
    const err = await assertRejects(() => resolveEndpoint("http://localhost:9222"));
    assertStringIncludes((err as Error).message, "HTTP 404");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveEndpoint: http:// missing webSocketDebuggerUrl field", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = () => {
    return Promise.resolve(
      new Response(JSON.stringify({ Browser: "Chrome/131" }), { status: 200 }),
    );
  };

  try {
    const err = await assertRejects(() => resolveEndpoint("http://localhost:9222"));
    assertStringIncludes((err as Error).message, "did not return a webSocketDebuggerUrl");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveEndpoint: invalid protocol throws", async () => {
  const err = await assertRejects(() => resolveEndpoint("ftp://chrome.local"));
  assertStringIncludes((err as Error).message, "Invalid Chrome endpoint");
  assertStringIncludes((err as Error).message, "ws://");
});
