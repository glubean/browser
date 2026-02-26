/**
 * E2E tests for Phase 7 interaction methods: fill, hover, select, press.
 * Uses the-internet.herokuapp.com which provides test pages for common UI patterns.
 */
import type {} from "@glubean/sdk";
import { screenshotTest } from "./configure.ts";

export const fillAndPress = screenshotTest(
  {
    id: "interaction-fill-press",
    name: "Fill a login form and press Enter",
    tags: ["interaction", "phase7"],
  },
  async (ctx) => {
    await ctx.page.goto("https://the-internet.herokuapp.com/login");

    // fill() clears existing value and types new text
    await ctx.page.fill("#username", "tomsmith");
    ctx.log("Filled username");

    await ctx.page.fill("#password", "SuperSecretPassword!");
    ctx.log("Filled password");

    // Verify inputValue reflects what fill() wrote
    const username = await ctx.page.inputValue("#username");
    ctx.expect(username).toBe("tomsmith");

    // press() to submit the form
    await ctx.page.press("Enter");
    ctx.log("Pressed Enter to submit");

    // Verify navigation to secure area
    await ctx.page.waitForURL("/secure");
    await ctx.page.expectText("#flash", /You logged into a secure area!/);
    ctx.log("Login successful — verified via expectText");
  },
);

export const hoverInteraction = screenshotTest(
  {
    id: "interaction-hover",
    name: "Hover over elements to reveal hidden content",
    tags: ["interaction", "phase7"],
  },
  async (ctx) => {
    await ctx.page.goto("https://the-internet.herokuapp.com/hovers");

    // Hover over the first user avatar to reveal the profile link
    const avatars = await ctx.page.$$(".figure");
    ctx.log("Avatar count", { count: avatars.length });
    ctx.expect(avatars.length).toBeGreaterThan(0);

    await ctx.page.hover(".figure:nth-child(1) img");
    ctx.log("Hovered over first avatar");

    // The caption should become visible after hover
    await ctx.page.expectVisible(".figure:nth-child(1) .figcaption");
    const name = await ctx.page.textContent(
      ".figure:nth-child(1) .figcaption h5",
    );
    ctx.log("Revealed profile name", { name });
    ctx.expect(name!.length).toBeGreaterThan(0);
  },
);

export const selectDropdown = screenshotTest(
  {
    id: "interaction-select",
    name: "Select options from a dropdown",
    tags: ["interaction", "phase7"],
  },
  async (ctx) => {
    await ctx.page.goto("https://the-internet.herokuapp.com/dropdown");

    // select() picks an option by value
    const selected = await ctx.page.select("#dropdown", "1");
    ctx.log("Selected option 1", { selected });
    ctx.expect(selected).toContain("1");

    // Verify the selection stuck
    const value = await ctx.page.inputValue("#dropdown");
    ctx.expect(value).toBe("1");

    // Switch selection
    const selected2 = await ctx.page.select("#dropdown", "2");
    ctx.log("Switched to option 2", { selected: selected2 });

    const value2 = await ctx.page.inputValue("#dropdown");
    ctx.expect(value2).toBe("2");
  },
);

export const fillOverwrite = screenshotTest(
  {
    id: "interaction-fill-overwrite",
    name: "Fill overwrites existing input value",
    tags: ["interaction", "phase7"],
  },
  async (ctx) => {
    await ctx.page.goto("https://the-internet.herokuapp.com/login");

    // Type initial value
    await ctx.page.type("#username", "initial");
    const before = await ctx.page.inputValue("#username");
    ctx.log("Before fill", { value: before });
    ctx.expect(before).toBe("initial");

    // fill() should replace, not append
    await ctx.page.fill("#username", "replaced");
    const after = await ctx.page.inputValue("#username");
    ctx.log("After fill", { value: after });
    ctx.expect(after).toBe("replaced");
  },
);
