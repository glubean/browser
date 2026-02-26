import { assertEquals } from "jsr:@std/assert";
import { shouldSkip } from "./network.ts";

// ---------------------------------------------------------------------------
// Protocol filtering
// ---------------------------------------------------------------------------

Deno.test("shouldSkip: data: URLs", () => {
  assertEquals(shouldSkip("data:text/html,<h1>Hi</h1>"), true);
  assertEquals(shouldSkip("data:image/png;base64,abc"), true);
});

Deno.test("shouldSkip: chrome-extension: URLs", () => {
  assertEquals(shouldSkip("chrome-extension://abc/popup.html"), true);
});

Deno.test("shouldSkip: devtools: URLs", () => {
  assertEquals(shouldSkip("devtools://devtools/bundled/inspector.html"), true);
});

Deno.test("shouldSkip: blob: URLs", () => {
  assertEquals(shouldSkip("blob:http://localhost:3000/abc-123"), true);
});

// ---------------------------------------------------------------------------
// Static asset extensions
// ---------------------------------------------------------------------------

Deno.test("shouldSkip: image extensions", () => {
  assertEquals(shouldSkip("https://cdn.example.com/logo.png"), true);
  assertEquals(shouldSkip("https://cdn.example.com/photo.jpg"), true);
  assertEquals(shouldSkip("https://cdn.example.com/photo.jpeg"), true);
  assertEquals(shouldSkip("https://cdn.example.com/icon.svg"), true);
  assertEquals(shouldSkip("https://cdn.example.com/anim.gif"), true);
  assertEquals(shouldSkip("https://cdn.example.com/hero.webp"), true);
  assertEquals(shouldSkip("https://cdn.example.com/favicon.ico"), true);
});

Deno.test("shouldSkip: font extensions", () => {
  assertEquals(shouldSkip("https://fonts.example.com/inter.woff"), true);
  assertEquals(shouldSkip("https://fonts.example.com/inter.woff2"), true);
  assertEquals(shouldSkip("https://fonts.example.com/inter.ttf"), true);
  assertEquals(shouldSkip("https://fonts.example.com/inter.eot"), true);
});

Deno.test("shouldSkip: CSS and source maps", () => {
  assertEquals(shouldSkip("https://example.com/styles/main.css"), true);
  assertEquals(shouldSkip("https://example.com/bundle.js.map"), true);
});

// ---------------------------------------------------------------------------
// Should NOT skip
// ---------------------------------------------------------------------------

Deno.test("shouldSkip: API endpoints pass through", () => {
  assertEquals(shouldSkip("https://api.example.com/v1/users"), false);
  assertEquals(shouldSkip("https://example.com/graphql"), false);
  assertEquals(shouldSkip("https://example.com/api/auth/login"), false);
});

Deno.test("shouldSkip: HTML pages pass through", () => {
  assertEquals(shouldSkip("https://example.com/index.html"), false);
  assertEquals(shouldSkip("https://example.com/"), false);
});

Deno.test("shouldSkip: JS files pass through", () => {
  assertEquals(shouldSkip("https://example.com/bundle.js"), false);
  assertEquals(shouldSkip("https://example.com/app.mjs"), false);
});

Deno.test("shouldSkip: URLs with query params still match extension", () => {
  assertEquals(shouldSkip("https://cdn.example.com/logo.png?v=2"), true);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test("shouldSkip: malformed URL does not skip", () => {
  assertEquals(shouldSkip("not-a-url"), false);
  assertEquals(shouldSkip(""), false);
});

Deno.test("shouldSkip: http:// and https:// protocols pass through", () => {
  assertEquals(shouldSkip("http://localhost:3000/api"), false);
  assertEquals(shouldSkip("https://example.com/api"), false);
});
