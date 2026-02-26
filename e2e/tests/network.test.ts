/**
 * E2E tests for Phase 8 network methods: waitForResponse, expectResponse.
 * Tests against real pages that trigger API calls via user interaction.
 */
import type {} from "@glubean/sdk";
import { screenshotTest } from "./configure.ts";

export const waitForResponseOnNavigation = screenshotTest(
  {
    id: "network-wait-response-navigation",
    name: "waitForResponse captures navigation response",
    tags: ["network", "phase8"],
  },
  async (ctx) => {
    // Navigate and capture the response in parallel
    const [response] = await Promise.all([
      ctx.page.waitForResponse("example.com"),
      ctx.page.goto("https://example.com"),
    ]);

    ctx.log("Captured response", {
      url: response.url(),
      status: response.status(),
    });
    ctx.expect(response.status()).toBe(200);
  },
);

export const expectResponseStatus = screenshotTest(
  {
    id: "network-expect-response-status",
    name: "expectResponse validates status code",
    tags: ["network", "phase8"],
  },
  async (ctx) => {
    // Use expectResponse to assert 200 on navigation
    const [response] = await Promise.all([
      ctx.page.expectResponse("example.com", { status: 200 }),
      ctx.page.goto("https://example.com"),
    ]);

    ctx.log("expectResponse passed", {
      url: response.url(),
      status: response.status(),
    });
  },
);

export const expectResponseWithHeaders = screenshotTest(
  {
    id: "network-expect-response-headers",
    name: "expectResponse validates response headers",
    tags: ["network", "phase8"],
  },
  async (ctx) => {
    const [response] = await Promise.all([
      ctx.page.expectResponse("example.com", {
        status: 200,
        headerContains: { "content-type": "text/html" },
      }),
      ctx.page.goto("https://example.com"),
    ]);

    ctx.log("Response headers validated", {
      contentType: response.headers()["content-type"],
    });
  },
);

export const waitForResponseWithRegex = screenshotTest(
  {
    id: "network-wait-response-regex",
    name: "waitForResponse with RegExp pattern",
    tags: ["network", "phase8"],
  },
  async (ctx) => {
    const [response] = await Promise.all([
      ctx.page.waitForResponse(/example\.com/),
      ctx.page.goto("https://example.com"),
    ]);

    ctx.log("Regex match captured", {
      url: response.url(),
      status: response.status(),
    });
    ctx.expect(response.url()).toContain("example.com");
  },
);

export const waitForRequestOnClick = screenshotTest(
  {
    id: "network-wait-request-click",
    name: "waitForRequest captures request triggered by navigation",
    tags: ["network", "phase8"],
  },
  async (ctx) => {
    await ctx.page.goto("https://example.com");

    // Click the link and capture the outgoing request to iana.org
    const [request] = await Promise.all([
      ctx.page.waitForRequest(/iana\.org/),
      ctx.page.click("a"),
    ]);

    ctx.log("Captured request", {
      url: request.url(),
      method: request.method(),
    });
    ctx.expect(request.url()).toContain("iana.org");
    ctx.expect(request.method()).toBe("GET");
  },
);
