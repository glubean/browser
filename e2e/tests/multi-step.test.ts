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

    // Step 2: Verify the heading
    const h1Text = await ctx.page.evaluate(
      () => document.querySelector("h1")?.textContent ?? "",
    );
    ctx.log("Page heading", { text: h1Text });
    ctx.expect(h1Text).toBe("Example Domain");

    // Step 3: Click the "More information..." link and wait for navigation
    await Promise.all([
      ctx.page.raw.waitForNavigation({ waitUntil: "load" }),
      ctx.page.raw.click("a"),
    ]);
    const newUrl = ctx.page.url();
    ctx.log("Navigated to", { url: newUrl });
    ctx.expect(newUrl).toContain("iana.org");

    // Step 4: Verify IANA page loaded
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

    // Step 3: Click "More" link to load page 2
    await ctx.page.click("a.morelink");
    const page2Url = ctx.page.url();
    ctx.log("Navigated to page 2", { url: page2Url });
    ctx.expect(page2Url).toContain("p=2");

    // Step 4: Verify page 2 also has stories
    const page2Stories = await ctx.page.$$(".athing");
    ctx.log("Stories on page 2", { count: page2Stories.length });
    ctx.expect(page2Stories.length).toBeGreaterThan(0);

    // Step 5: Click "new" link in the nav
    await ctx.page.click('a[href="newest"]');
    const newestUrl = ctx.page.url();
    ctx.log("Navigated to newest", { url: newestUrl });
    ctx.expect(newestUrl).toContain("newest");
  },
);
