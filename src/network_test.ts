import { assertEquals } from "jsr:@std/assert";
import { shouldInclude, shouldSkipProtocol } from "./network.ts";

// ---------------------------------------------------------------------------
// Protocol filtering
// ---------------------------------------------------------------------------

Deno.test("shouldSkipProtocol: data: URLs", () => {
  assertEquals(shouldSkipProtocol("data:text/html,<h1>Hi</h1>"), true);
  assertEquals(shouldSkipProtocol("data:image/png;base64,abc"), true);
});

Deno.test("shouldSkipProtocol: chrome-extension: URLs", () => {
  assertEquals(shouldSkipProtocol("chrome-extension://abc/popup.html"), true);
});

Deno.test("shouldSkipProtocol: devtools: URLs", () => {
  assertEquals(shouldSkipProtocol("devtools://devtools/bundled/inspector.html"), true);
});

Deno.test("shouldSkipProtocol: blob: URLs", () => {
  assertEquals(shouldSkipProtocol("blob:http://localhost:3000/abc-123"), true);
});

Deno.test("shouldSkipProtocol: http/https pass through", () => {
  assertEquals(shouldSkipProtocol("http://localhost:3000/api"), false);
  assertEquals(shouldSkipProtocol("https://example.com/api"), false);
});

// ---------------------------------------------------------------------------
// Content-type include filtering
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE = ["application/json", "text/html"];

Deno.test("shouldInclude: JSON content-type", () => {
  assertEquals(shouldInclude("application/json", DEFAULT_INCLUDE), true);
  assertEquals(shouldInclude("application/json; charset=utf-8", DEFAULT_INCLUDE), true);
});

Deno.test("shouldInclude: HTML content-type", () => {
  assertEquals(shouldInclude("text/html", DEFAULT_INCLUDE), true);
  assertEquals(shouldInclude("text/html; charset=utf-8", DEFAULT_INCLUDE), true);
});

Deno.test("shouldInclude: static assets excluded by default", () => {
  assertEquals(shouldInclude("text/javascript", DEFAULT_INCLUDE), false);
  assertEquals(shouldInclude("text/css", DEFAULT_INCLUDE), false);
  assertEquals(shouldInclude("image/png", DEFAULT_INCLUDE), false);
  assertEquals(shouldInclude("image/svg+xml", DEFAULT_INCLUDE), false);
  assertEquals(shouldInclude("font/woff2", DEFAULT_INCLUDE), false);
  assertEquals(shouldInclude("application/javascript", DEFAULT_INCLUDE), false);
});

Deno.test("shouldInclude: custom include list", () => {
  const custom = ["application/json", "text/xml", "application/graphql"];
  assertEquals(shouldInclude("text/xml", custom), true);
  assertEquals(shouldInclude("application/graphql-response+json", custom), false);
  assertEquals(shouldInclude("text/html", custom), false);
});

Deno.test("shouldInclude: case insensitive", () => {
  assertEquals(shouldInclude("Application/JSON", DEFAULT_INCLUDE), true);
  assertEquals(shouldInclude("TEXT/HTML", DEFAULT_INCLUDE), true);
});

Deno.test("shouldInclude: empty content-type excluded", () => {
  assertEquals(shouldInclude("", DEFAULT_INCLUDE), false);
});
