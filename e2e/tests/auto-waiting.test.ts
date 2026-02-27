/**
 * E2E tests for navigation auto-wait and assertion auto-retry methods.
 */
import type {} from "@glubean/sdk";
import { screenshotTest } from "./configure.ts";

export const expectTextAndVisible = screenshotTest(
  {
    id: "auto-wait-expect-text-visible",
    name: "expectText and expectVisible on example.com",
    tags: ["assertions", "navigation"],
  },
  async (ctx) => {
    await ctx.page.goto("https://example.com");

    // textContent — waits for element, returns content
    const heading = await ctx.page.textContent("h1");
    ctx.log("textContent result", { heading });
    ctx.expect(heading).toBe("Example Domain");

    // innerText
    const bodyText = await ctx.page.innerText("body");
    ctx.log("Body text length", { length: bodyText.length });
    ctx.expect(bodyText.length).toBeGreaterThan(0);

    // getAttribute
    const href = await ctx.page.getAttribute("a", "href");
    ctx.log("Link href", { href });
    ctx.expect(href).toContain("iana.org");

    // isVisible / isEnabled — instant checks
    const linkVisible = await ctx.page.isVisible("a");
    ctx.log("Link visible", { visible: linkVisible });
    ctx.expect(linkVisible).toBe(true);

    const linkEnabled = await ctx.page.isEnabled("a");
    ctx.log("Link enabled", { enabled: linkEnabled });
    ctx.expect(linkEnabled).toBe(true);

    // expectText — retries until text matches
    await ctx.page.expectText("h1", "Example Domain");
    ctx.log("expectText passed for h1");

    // expectVisible — retries until element is visible
    await ctx.page.expectVisible("a");
    ctx.log("expectVisible passed for link");

    // expectAttribute — retries until attribute matches
    await ctx.page.expectAttribute("a", "href", /iana\.org/);
    ctx.log("expectAttribute passed for link href");

    // expectCount — retries until element count matches
    await ctx.page.expectCount("div p", 2);
    ctx.log("expectCount passed — 2 paragraphs found");
  },
);

export const hackerNewsAutoWaiting = screenshotTest(
  {
    id: "auto-wait-hn-navigation",
    name: "Hacker News navigation with waitForURL and expectText",
    tags: ["assertions", "navigation"],
  },
  async (ctx) => {
    await ctx.page.goto("https://news.ycombinator.com");

    // expectText on the page title link
    await ctx.page.expectText("a.hnname", "Hacker News");
    ctx.log("HN title verified via expectText");

    const storyCount = (await ctx.page.$$(".athing")).length;
    ctx.log("Stories on page", { count: storyCount });
    ctx.expect(storyCount).toBeGreaterThan(0);

    // click() delegates to Locator for auto-wait, then waitForURL polls URL
    await ctx.page.click("a.morelink");
    await ctx.page.waitForURL("p=2");
    ctx.log("Navigated to page 2 via waitForURL");

    // expectURL — retries until URL matches
    await ctx.page.expectURL("p=2");
    ctx.log("expectURL confirmed page 2");

    // textContent on a nav link
    const newLinkText = await ctx.page.textContent('a[href="newest"]');
    ctx.log("Nav link text", { text: newLinkText });
    ctx.expect(newLinkText).toBe("new");

    await ctx.page.click('a[href="newest"]');
    await ctx.page.waitForURL("newest");
    ctx.log("Navigated to newest via waitForURL");

    await ctx.page.expectVisible(".athing");
    ctx.log("Stories visible on newest page");
  },
);

export const locatorChainTest = screenshotTest(
  {
    id: "auto-wait-locator-chain",
    name: "Locator chain methods with auto-tracing",
    tags: ["locator", "auto-waiting"],
  },
  async (ctx) => {
    await ctx.page.goto("https://example.com");

    // locator().click() — same as page.click() but via the locator API
    await ctx.page.locator("a").setTimeout(5000).click();
    await ctx.page.waitForURL("iana.org");
    ctx.log("Clicked link via locator chain, navigated to IANA");

    // Verify navigation worked
    const title = await ctx.page.title();
    ctx.log("IANA page title", { title });
    ctx.expect(title.length).toBeGreaterThan(0);
  },
);

export const glubeanLandingAutoWait = screenshotTest(
  {
    id: "auto-wait-glubean-landing",
    name: "Glubean landing page with expectText and expectVisible",
    tags: ["assertions", "landing"],
  },
  async (ctx) => {
    await ctx.page.goto("https://glubean.com");

    await ctx.page.expectVisible("h1");
    ctx.log("h1 is visible on landing page");

    const h1 = await ctx.page.textContent("h1");
    ctx.log("Landing h1 text", { text: h1 });
    ctx.expect(h1!.length).toBeGreaterThan(0);

    await ctx.page.expectText("body", /glubean/i);
    ctx.log("Body contains 'glubean' (case-insensitive)");

    await ctx.page.expectVisible('a[href*="marketplace.visualstudio.com"]');
    ctx.log("VS Code CTA link is visible");

    const ctaHref = await ctx.page.getAttribute(
      'a[href*="marketplace.visualstudio.com"]',
      "href",
    );
    ctx.log("CTA href", { href: ctaHref });
    ctx.expect(ctaHref).toContain("marketplace.visualstudio.com");
  },
);
