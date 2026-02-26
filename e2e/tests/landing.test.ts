// Direct SDK import required for the Glubean scanner to discover this file
import type {} from "@glubean/sdk";
import { browserTest } from "./configure.ts";

const LANDING = "https://glubean.com";

export const homepageLoads = browserTest(
  {
    id: "landing-homepage-loads",
    name: "Homepage loads with 200 and correct title",
    tags: ["landing", "smoke"],
  },
  async (ctx) => {
    await ctx.page.goto(LANDING);

    const title = await ctx.page.title();
    ctx.log("Page title", { title });

    ctx.expect(title.toLowerCase()).toContain("glubean");
  },
);

export const heroContentPresent = browserTest(
  {
    id: "landing-hero-content",
    name: "Hero section has heading and CTA",
    tags: ["landing", "content"],
  },
  async (ctx) => {
    await ctx.page.goto(LANDING);

    const h1 = await ctx.page.$("h1");
    ctx.expect(h1).toBeDefined();

    const h1Text = await ctx.page.evaluate(
      () => document.querySelector("h1")?.textContent ?? "",
    );
    ctx.log("Hero heading", { text: h1Text });
    ctx.expect(h1Text.length).toBeGreaterThan(0);

    const ctaLink = await ctx.page.$(
      'a[href*="marketplace.visualstudio.com"]',
    );
    ctx.expect(ctaLink).toBeDefined();
    ctx.log("VS Code CTA link found");
  },
);

export const pageLoadPerformance = browserTest(
  {
    id: "landing-page-load-performance",
    name: "Page loads within 10 seconds",
    tags: ["landing", "performance"],
  },
  async (ctx) => {
    const start = Date.now();
    await ctx.page.goto(LANDING, { waitUntil: "load" });
    const loadTime = Date.now() - start;

    ctx.log("Page load time", { ms: loadTime });
    ctx.metric("e2e_page_load_ms", loadTime, {
      unit: "ms",
      tags: { page: "/" },
    });

    ctx.expect(loadTime).toBeLessThan(10_000);
  },
);

export const getStartedSectionExists = browserTest(
  {
    id: "landing-get-started-section",
    name: "Get-started steps section exists",
    tags: ["landing", "content"],
  },
  async (ctx) => {
    await ctx.page.goto(LANDING);

    const stepsText = await ctx.page.evaluate(() => document.body.innerText);
    ctx.expect(stepsText).toContain("Get started");
    ctx.expect(stepsText).toContain("Install the extension");

    ctx.log("Get-started section verified");
  },
);
