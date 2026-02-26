/**
 * Actionability checks for browser auto-waiting.
 *
 * Before performing `click()`, `type()`, or other interaction methods,
 * `waitForActionable()` polls until the target element satisfies all
 * required conditions (attached, visible, enabled) or times out with
 * a diagnostic error.
 *
 * @module actionability
 */

import type { Page } from "puppeteer-core";

/** Actionability condition identifiers. */
export type ActionCheck = "attached" | "visible" | "enabled";

/** Options for `waitForActionable()`. */
export interface ActionabilityOptions {
  /** Timeout in ms. Default: 30 000. */
  timeout?: number;
  /** Subset of checks to run. Default: all Phase-1 checks. */
  checks?: ActionCheck[];
  /** Skip all checks and return immediately. */
  force?: boolean;
}

/** Per-action option bag exposed on `click()` / `type()`. */
export interface ActionOptions {
  /** Timeout in ms (overrides the global `actionTimeout`). */
  timeout?: number;
  /** Skip all actionability checks. */
  force?: boolean;
}

/** Diagnostic snapshot collected when actionability times out. */
export interface ActionDiagnostics {
  selector: string;
  failedCheck: ActionCheck;
  elementFound: boolean;
  computedVisibility: string | null;
  computedDisplay: string | null;
  isDisabled: boolean | null;
  elapsed: number;
  timeout: number;
}

/**
 * Error thrown when an element does not become actionable within the timeout.
 *
 * Contains structured `diagnostics` describing exactly which check failed
 * and the element's state at timeout.
 */
export class ActionabilityError extends Error {
  readonly failedCheck: ActionCheck;
  readonly diagnostics: ActionDiagnostics;

  constructor(
    selector: string,
    failedCheck: ActionCheck,
    diagnostics: ActionDiagnostics,
  ) {
    const lines = [
      `waitForActionable("${selector}") timed out after ${diagnostics.timeout}ms`,
      "",
      `  Failed check: ${failedCheck}`,
      `  Element found: ${diagnostics.elementFound ? "yes" : "no"}`,
    ];

    if (diagnostics.elementFound) {
      lines.push(`  display: ${diagnostics.computedDisplay ?? "unknown"}`);
      lines.push(
        `  visibility: ${diagnostics.computedVisibility ?? "unknown"}`,
      );
      lines.push(
        `  disabled: ${diagnostics.isDisabled === null ? "unknown" : diagnostics.isDisabled}`,
      );
    }

    lines.push("");
    lines.push(
      '  Hint: Use { force: true } to skip actionability checks.',
    );

    super(lines.join("\n"));
    this.name = "ActionabilityError";
    this.failedCheck = failedCheck;
    this.diagnostics = diagnostics;
  }
}

const DEFAULT_TIMEOUT = 30_000;
const POLL_INTERVAL = 100;

/**
 * Minimal Page-like interface accepted by `waitForActionable`.
 *
 * Defined here so unit tests can pass a mock without importing puppeteer-core.
 */
export interface ActionablePage {
  waitForSelector(
    selector: string,
    options?: { visible?: boolean; timeout?: number },
  ): Promise<unknown>;
  // deno-lint-ignore no-explicit-any
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
}

/** @internal Shape returned by the in-browser `getElementState` function. */
export interface ElementState {
  found: boolean;
  computedDisplay: string | null;
  computedVisibility: string | null;
  isDisabled: boolean | null;
}

/**
 * Runs inside the browser page context via `page.evaluate()`.
 * Uses `globalThis` casts to satisfy Deno's type checker (no DOM lib).
 */
function getElementState(selector: string): ElementState {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const el = g.document.querySelector(selector);
  if (!el) {
    return {
      found: false,
      computedDisplay: null,
      computedVisibility: null,
      isDisabled: null,
    };
  }
  const style = g.getComputedStyle(el);
  const disabled: boolean = "disabled" in el
    ? !!el.disabled
    : el.getAttribute("aria-disabled") === "true";
  return {
    found: true,
    computedDisplay: style.display,
    computedVisibility: style.visibility,
    isDisabled: disabled,
  };
}

/**
 * Wait until the element matching `selector` is attached, visible, and enabled.
 *
 * Throws `ActionabilityError` with diagnostics if the element does not become
 * actionable within the timeout.
 */
export async function waitForActionable(
  page: ActionablePage,
  selector: string,
  options?: ActionabilityOptions,
): Promise<void> {
  if (options?.force) return;

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const checks = options?.checks ?? ["attached", "visible", "enabled"];
  const start = Date.now();

  const needsVisible = checks.includes("attached") ||
    checks.includes("visible");
  const needsEnabled = checks.includes("enabled");

  while (true) {
    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) break;

    try {
      if (needsVisible) {
        await page.waitForSelector(selector, {
          visible: true,
          timeout: Math.min(remaining, POLL_INTERVAL * 3),
        });
      }

      if (needsEnabled) {
        const state = await evaluateElementState(page, selector);
        if (state.isDisabled) {
          if (Date.now() - start >= timeout) break;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          continue;
        }
      }

      return;
    } catch {
      if (Date.now() - start >= timeout) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
  }

  const failedCheck = await detectFailedCheck(
    page,
    selector,
    needsVisible,
    needsEnabled,
  );
  const state = await safeGetState(page, selector);
  const elapsed = Date.now() - start;

  throw new ActionabilityError(selector, failedCheck, {
    selector,
    failedCheck,
    elementFound: state.found,
    computedVisibility: state.computedVisibility,
    computedDisplay: state.computedDisplay,
    isDisabled: state.isDisabled,
    elapsed,
    timeout,
  });
}

async function detectFailedCheck(
  page: ActionablePage,
  selector: string,
  needsVisible: boolean,
  needsEnabled: boolean,
): Promise<ActionCheck> {
  const state = await safeGetState(page, selector);

  if (!state.found) return "attached";

  if (needsVisible) {
    if (
      state.computedDisplay === "none" ||
      state.computedVisibility === "hidden" ||
      state.computedVisibility === "collapse"
    ) {
      return "visible";
    }
  }

  if (needsEnabled && state.isDisabled) return "enabled";

  return needsVisible ? "visible" : "enabled";
}

function evaluateElementState(
  page: ActionablePage,
  selector: string,
): Promise<ElementState> {
  return page.evaluate(getElementState, selector) as Promise<ElementState>;
}

async function safeGetState(
  page: ActionablePage,
  selector: string,
): Promise<ElementState> {
  try {
    return await evaluateElementState(page, selector);
  } catch {
    return {
      found: false,
      computedDisplay: null,
      computedVisibility: null,
      isDisabled: null,
    };
  }
}

/**
 * Cast a Puppeteer `Page` to `ActionablePage`.
 *
 * Puppeteer's Page satisfies the interface structurally but TypeScript
 * can't verify it due to overloaded signatures. This helper avoids
 * `as unknown as` casts at every call site.
 */
export function asActionablePage(page: Page): ActionablePage {
  return page as unknown as ActionablePage;
}
