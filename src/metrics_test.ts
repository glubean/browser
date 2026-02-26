import { assertEquals } from "jsr:@std/assert";
import { collectNavigationMetrics } from "./metrics.ts";

function makeMockPage(timing: {
  navigationStart: number;
  domContentLoadedEventEnd: number;
  loadEventEnd: number;
}) {
  return {
    evaluate: (_fn: unknown) => Promise.resolve(timing),
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeBrokenPage() {
  return {
    evaluate: () =>
      Promise.reject(new Error("Execution context was destroyed")),
    // deno-lint-ignore no-explicit-any
  } as any;
}

// ---------------------------------------------------------------------------
// Normal timing
// ---------------------------------------------------------------------------

Deno.test("collectNavigationMetrics: emits page_load_ms and dom_content_loaded_ms", async () => {
  const emitted: Array<
    { name: string; value: number; tags?: Record<string, string> }
  > = [];

  const page = makeMockPage({
    navigationStart: 1000,
    domContentLoadedEventEnd: 1300,
    loadEventEnd: 1500,
  });

  await collectNavigationMetrics(
    page,
    (name, value, options) => {
      emitted.push({ name, value, tags: options?.tags });
    },
    "https://example.com/dashboard",
  );

  assertEquals(emitted.length, 2);

  assertEquals(emitted[0].name, "page_load_ms");
  assertEquals(emitted[0].value, 500);
  assertEquals(emitted[0].tags?.url, "/dashboard");

  assertEquals(emitted[1].name, "dom_content_loaded_ms");
  assertEquals(emitted[1].value, 300);
});

// ---------------------------------------------------------------------------
// Zero loadEventEnd (page not fully loaded)
// ---------------------------------------------------------------------------

Deno.test("collectNavigationMetrics: skips page_load_ms when loadEventEnd is 0", async () => {
  const emitted: Array<{ name: string; value: number }> = [];

  const page = makeMockPage({
    navigationStart: 1000,
    domContentLoadedEventEnd: 1200,
    loadEventEnd: 0,
  });

  await collectNavigationMetrics(
    page,
    (name, value) => {
      emitted.push({ name, value });
    },
    "https://example.com/",
  );

  assertEquals(emitted.length, 1);
  assertEquals(emitted[0].name, "dom_content_loaded_ms");
  assertEquals(emitted[0].value, 200);
});

// ---------------------------------------------------------------------------
// Zero navigationStart
// ---------------------------------------------------------------------------

Deno.test("collectNavigationMetrics: skips all when navigationStart is 0", async () => {
  const emitted: Array<{ name: string }> = [];

  const page = makeMockPage({
    navigationStart: 0,
    domContentLoadedEventEnd: 1200,
    loadEventEnd: 1500,
  });

  await collectNavigationMetrics(
    page,
    (name) => {
      emitted.push({ name });
    },
    "https://example.com/",
  );

  assertEquals(emitted.length, 0);
});

// ---------------------------------------------------------------------------
// page.evaluate throws
// ---------------------------------------------------------------------------

Deno.test("collectNavigationMetrics: silently handles evaluate failure", async () => {
  const emitted: Array<{ name: string }> = [];

  await collectNavigationMetrics(
    makeBrokenPage(),
    (name) => {
      emitted.push({ name });
    },
    "https://example.com/",
  );

  assertEquals(emitted.length, 0);
});

// ---------------------------------------------------------------------------
// URL shortening in tags
// ---------------------------------------------------------------------------

Deno.test("collectNavigationMetrics: shortens URL to pathname + search in tags", async () => {
  const emitted: Array<{ tags?: Record<string, string> }> = [];

  const page = makeMockPage({
    navigationStart: 1000,
    domContentLoadedEventEnd: 1200,
    loadEventEnd: 1500,
  });

  await collectNavigationMetrics(
    page,
    (_name, _value, options) => {
      emitted.push({ tags: options?.tags });
    },
    "https://example.com/search?q=glubean&page=1",
  );

  assertEquals(emitted[0].tags?.url, "/search?q=glubean&page=1");
});
