import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  ActionabilityError,
  type ActionablePage,
  type ElementState,
  waitForActionable,
} from "./actionability.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const READY_STATE: ElementState = {
  found: true,
  computedDisplay: "block",
  computedVisibility: "visible",
  isDisabled: false,
};

const DISABLED_STATE: ElementState = {
  found: true,
  computedDisplay: "block",
  computedVisibility: "visible",
  isDisabled: true,
};

const NOT_FOUND_STATE: ElementState = {
  found: false,
  computedDisplay: null,
  computedVisibility: null,
  isDisabled: null,
};

const HIDDEN_STATE: ElementState = {
  found: true,
  computedDisplay: "none",
  computedVisibility: "visible",
  isDisabled: false,
};

function makeMockPage(opts: {
  waitForSelectorFn?: (
    selector: string,
    options?: { visible?: boolean; timeout?: number },
  ) => Promise<unknown>;
  evaluateState?: ElementState | (() => ElementState);
}): ActionablePage {
  return {
    waitForSelector: opts.waitForSelectorFn ??
      (() => Promise.resolve({})),
    evaluate: (_fn: unknown, ..._args: unknown[]) => {
      const state = typeof opts.evaluateState === "function"
        ? opts.evaluateState()
        : (opts.evaluateState ?? READY_STATE);
      return Promise.resolve(state);
    },
  } as unknown as ActionablePage;
}

// ---------------------------------------------------------------------------
// force: true
// ---------------------------------------------------------------------------

Deno.test("force: true returns immediately without calling evaluate", async () => {
  let evaluateCalled = false;
  const page = makeMockPage({
    evaluateState: () => {
      evaluateCalled = true;
      return READY_STATE;
    },
  });

  await waitForActionable(page, "#btn", { force: true });
  assertEquals(evaluateCalled, false);
});

// ---------------------------------------------------------------------------
// Happy path — already actionable
// ---------------------------------------------------------------------------

Deno.test("passes when element is visible and enabled", async () => {
  const page = makeMockPage({ evaluateState: READY_STATE });

  const start = Date.now();
  await waitForActionable(page, "#btn", { timeout: 5000 });
  assert(Date.now() - start < 500, "should return quickly");
});

// ---------------------------------------------------------------------------
// Retry — visibility
// ---------------------------------------------------------------------------

Deno.test("retries until element becomes visible", async () => {
  let calls = 0;
  const page = makeMockPage({
    waitForSelectorFn: () => {
      calls++;
      if (calls <= 2) return Promise.reject(new Error("timeout"));
      return Promise.resolve({});
    },
    evaluateState: READY_STATE,
  });

  await waitForActionable(page, "#btn", { timeout: 5000 });
  assert(calls >= 3, `expected >= 3 waitForSelector calls, got ${calls}`);
});

// ---------------------------------------------------------------------------
// Retry — enabled
// ---------------------------------------------------------------------------

Deno.test("retries until element becomes enabled", async () => {
  let evaluateCalls = 0;
  const page = makeMockPage({
    evaluateState: () => {
      evaluateCalls++;
      if (evaluateCalls <= 2) return DISABLED_STATE;
      return READY_STATE;
    },
  });

  await waitForActionable(page, "#input", { timeout: 5000 });
  assert(
    evaluateCalls >= 3,
    `expected >= 3 evaluate calls, got ${evaluateCalls}`,
  );
});

// ---------------------------------------------------------------------------
// Timeout — never visible
// ---------------------------------------------------------------------------

Deno.test("times out with ActionabilityError when element never visible", async () => {
  const page = makeMockPage({
    waitForSelectorFn: () => Promise.reject(new Error("timeout")),
    evaluateState: NOT_FOUND_STATE,
  });

  const err = await assertRejects(
    () => waitForActionable(page, "#ghost", { timeout: 500 }),
  );
  assertInstanceOf(err, ActionabilityError);
  assertEquals(err.failedCheck, "attached");
  assert(err.diagnostics.elapsed >= 400, `elapsed too short: ${err.diagnostics.elapsed}ms`);
  assertEquals(err.diagnostics.timeout, 500);
});

// ---------------------------------------------------------------------------
// Timeout — stays disabled
// ---------------------------------------------------------------------------

Deno.test("times out with ActionabilityError when element stays disabled", async () => {
  const page = makeMockPage({
    evaluateState: DISABLED_STATE,
  });

  const err = await assertRejects(
    () => waitForActionable(page, "#input", { timeout: 500 }),
  );
  assertInstanceOf(err, ActionabilityError);
  assertEquals(err.failedCheck, "enabled");
  assertEquals(err.diagnostics.isDisabled, true);
});

// ---------------------------------------------------------------------------
// Timeout — hidden (display: none)
// ---------------------------------------------------------------------------

Deno.test("times out with visible check when display is none", async () => {
  const page = makeMockPage({
    waitForSelectorFn: () => Promise.reject(new Error("timeout")),
    evaluateState: HIDDEN_STATE,
  });

  const err = await assertRejects(
    () => waitForActionable(page, "#hidden", { timeout: 500 }),
  );
  assertInstanceOf(err, ActionabilityError);
  assertEquals(err.failedCheck, "visible");
  assertEquals(err.diagnostics.computedDisplay, "none");
});

// ---------------------------------------------------------------------------
// Error message quality
// ---------------------------------------------------------------------------

Deno.test("error message includes selector and force hint", async () => {
  const page = makeMockPage({
    waitForSelectorFn: () => Promise.reject(new Error("timeout")),
    evaluateState: NOT_FOUND_STATE,
  });

  const err = await assertRejects(
    () => waitForActionable(page, "button.submit", { timeout: 300 }),
  );
  assertInstanceOf(err, ActionabilityError);
  assertStringIncludes(err.message, "button.submit");
  assertStringIncludes(err.message, "force: true");
  assertEquals(err.name, "ActionabilityError");
});

// ---------------------------------------------------------------------------
// Diagnostics populated
// ---------------------------------------------------------------------------

Deno.test("diagnostics fully populated on timeout", async () => {
  const page = makeMockPage({
    evaluateState: DISABLED_STATE,
  });

  const err = await assertRejects(
    () => waitForActionable(page, "#email", { timeout: 400 }),
  );
  assertInstanceOf(err, ActionabilityError);

  const d = err.diagnostics;
  assertEquals(d.selector, "#email");
  assertEquals(d.elementFound, true);
  assertEquals(d.computedDisplay, "block");
  assertEquals(d.computedVisibility, "visible");
  assertEquals(d.isDisabled, true);
  assertEquals(d.timeout, 400);
  assert(d.elapsed >= 300, `elapsed too short: ${d.elapsed}ms`);
});

// ---------------------------------------------------------------------------
// Custom checks subset
// ---------------------------------------------------------------------------

Deno.test("checks: ['enabled'] skips visibility check", async () => {
  let waitForSelectorCalled = false;
  const page = makeMockPage({
    waitForSelectorFn: () => {
      waitForSelectorCalled = true;
      return Promise.resolve({});
    },
    evaluateState: READY_STATE,
  });

  await waitForActionable(page, "#btn", {
    timeout: 1000,
    checks: ["enabled"],
  });
  assertEquals(waitForSelectorCalled, false);
});
