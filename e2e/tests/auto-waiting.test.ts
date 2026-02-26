/**
 * E2E tests exercising Phase 4 (Navigation Auto-Wait) and Phase 5 (Assertion Auto-Retry)
 * methods against real websites via the Glubean runner.
 */
import type {} from "@glubean/sdk";
import { screenshotTest } from "./configure.ts";

export const expectTextAndVisible = screenshotTest(
  {
    id: "auto-wait-expect-text-visible",
    name: "expectText and expectVisible on example.com",
    tags: ["auto-waiting", "phase4", "phase5"],
  },
  async (ctx) => {
    await ctx.page.goto("https://example.com");

    // Phase 4: textContent waits for element and returns content
    const heading = await ctx.page.textContent("h1");
    ctx.log("textContent result", { heading });
    ctx.expect(heading).toBe("Example Domain");

    // Phase 4: innerText
    const bodyText = await ctx.page.innerText("body");
    ctx.log("Body text length", { length: bodyText.length });
    ctx.expect(bodyText.length).toBeGreaterThan(0);

    // Phase 4: getAttribute
    const href = await ctx.page.getAttribute("a", "href");
    ctx.log("Link href", { href });
    ctx.expect(href).toContain("iana.org");

    // Phase 4: isVisible / isEnabled
    const linkVisible = await ctx.page.isVisible("a");
    ctx.log("Link visible", { visible: linkVisible });
    ctx.expect(linkVisible).toBe(true);

    const linkEnabled = await ctx.page.isEnabled("a");
    ctx.log("Link enabled", { enabled: linkEnabled });
    ctx.expect(linkEnabled).toBe(true);

    // Phase 5: expectText — asserts text matches
    await ctx.page.expectText("h1", "Example Domain");
    ctx.log("expectText passed for h1");

    // Phase 5: expectVisible
    await ctx.page.expectVisible("a");
    ctx.log("expectVisible passed for link");

    // Phase 5: expectAttribute
    await ctx.page.expectAttribute("a", "href", /iana\.org/);
    ctx.log("expectAttribute passed for link href");

    // Phase 5: expectCount — there is exactly 1 <p> inside the div
    await ctx.page.expectCount("div p", 2);
    ctx.log("expectCount passed — 2 paragraphs found");
  },
);

export const hackerNewsAutoWaiting = screenshotTest(
  {
    id: "auto-wait-hn-navigation",
    name: "Hacker News navigation with waitForURL and expectText",
    tags: ["auto-waiting", "phase4", "phase5"],
  },
  async (ctx) => {
    await ctx.page.goto("https://news.ycombinator.com");

    // Phase 5: expectText on the page title link
    await ctx.page.expectText("a.hnname", "Hacker News");
    ctx.log("HN title verified via expectText");

    // Phase 5: expectCount — at least some stories present
    const storyCount = (await ctx.page.$$(".athing")).length;
    ctx.log("Stories on page", { count: storyCount });
    ctx.expect(storyCount).toBeGreaterThan(0);

    // Click "More" and use Phase 4: waitForURL
    await ctx.page.click("a.morelink");
    await ctx.page.waitForURL("p=2");
    ctx.log("Navigated to page 2 via waitForURL");

    // Phase 5: expectURL — confirm we're on page 2
    await ctx.page.expectURL("p=2");
    ctx.log("expectURL confirmed page 2");

    // Phase 4: textContent on a nav link
    const newLinkText = await ctx.page.textContent('a[href="newest"]');
    ctx.log("Nav link text", { text: newLinkText });
    ctx.expect(newLinkText).toBe("new");

    // Click "new" and waitForURL
    await ctx.page.click('a[href="newest"]');
    await ctx.page.waitForURL("newest");
    ctx.log("Navigated to newest via waitForURL");

    // Phase 5: verify stories exist on newest page
    await ctx.page.expectVisible(".athing");
    ctx.log("Stories visible on newest page");
  },
);

export const glubeanLandingAutoWait = screenshotTest(
  {
    id: "auto-wait-glubean-landing",
    name: "Glubean landing page with expectText and expectVisible",
    tags: ["auto-waiting", "phase5", "landing"],
  },
  async (ctx) => {
    await ctx.page.goto("https://glubean.com");

    // Phase 5: expectVisible on the main heading
    await ctx.page.expectVisible("h1");
    ctx.log("h1 is visible on landing page");

    // Phase 4: textContent
    const h1 = await ctx.page.textContent("h1");
    ctx.log("Landing h1 text", { text: h1 });
    ctx.expect(h1!.length).toBeGreaterThan(0);

    // Phase 5: expectText with regex
    await ctx.page.expectText("body", /glubean/i);
    ctx.log("Body contains 'glubean' (case-insensitive)");

    // Phase 5: expectVisible on VS Code CTA link
    await ctx.page.expectVisible('a[href*="marketplace.visualstudio.com"]');
    ctx.log("VS Code CTA link is visible");

    // Phase 4: getAttribute on the CTA link
    const ctaHref = await ctx.page.getAttribute(
      'a[href*="marketplace.visualstudio.com"]',
      "href",
    );
    ctx.log("CTA href", { href: ctaHref });
    ctx.expect(ctaHref).toContain("marketplace.visualstudio.com");
  },
);
