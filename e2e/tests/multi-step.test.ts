import type {} from "@glubean/sdk";
import { screenshotTest } from "./configure.ts";

export const exampleDotComFlow = screenshotTest(
  {
    id: "example-com-multi-step",
    name: "Navigate example.com and verify structure",
    tags: ["multi-step", "screenshot"],
  },
  async (ctx) => {
    // Step 1: Navigate to example.com
    await ctx.page.goto("https://example.com");
    const title = await ctx.page.title();
    ctx.log("Example.com loaded", { title });
    ctx.expect(title).toContain("Example Domain");

    // Step 2: expectText — retries until text matches
    await ctx.page.expectText("h1", "Example Domain");
    ctx.log("Heading verified via expectText");

    // Step 3: click() delegates to Locator for auto-wait, waitForURL polls URL
    await ctx.page.click("a");
    await ctx.page.waitForURL("iana.org");
    ctx.log("Navigated to IANA via waitForURL");

    // Step 4: Verify IANA page loaded using expectVisible
    await ctx.page.expectVisible("body");
    const ianaTitle = await ctx.page.title();
    ctx.log("IANA page title", { title: ianaTitle });
    ctx.expect(ianaTitle.length).toBeGreaterThan(0);
  },
);

export const hackerNewsNavigation = screenshotTest(
  {
    id: "hackernews-multi-step",
    name: "Browse Hacker News top stories and navigate to comments",
    tags: ["multi-step", "screenshot"],
  },
  async (ctx) => {
    // Step 1: Load Hacker News
    await ctx.page.goto("https://news.ycombinator.com");
    const title = await ctx.page.title();
    ctx.log("HN loaded", { title });
    ctx.expect(title).toContain("Hacker News");

    // Step 2: Verify the story list is present
    const stories = await ctx.page.$$(".athing");
    ctx.log("Stories on page", { count: stories.length });
    ctx.expect(stories.length).toBeGreaterThan(0);

    // Step 3: Click "More" and use waitForURL instead of manual URL check
    await ctx.page.click("a.morelink");
    await ctx.page.waitForURL("p=2");
    ctx.log("Navigated to page 2 via waitForURL");

    // Step 4: Verify page 2 stories with expectVisible
    await ctx.page.expectVisible(".athing");
    const page2Stories = await ctx.page.$$(".athing");
    ctx.log("Stories on page 2", { count: page2Stories.length });
    ctx.expect(page2Stories.length).toBeGreaterThan(0);

    // Step 5: Click "new" link and use waitForURL
    await ctx.page.click('a[href="newest"]');
    await ctx.page.waitForURL("newest");
    ctx.log("Navigated to newest via waitForURL");
  },
);
