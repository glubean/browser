import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  ActionabilityError,
  type ActionableHandle,
  type ActionablePage,
  type ElementState,
  waitForActionable,
} from "./actionability.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type HandleState = Omit<ElementState, "found">;

const READY_HANDLE: HandleState = {
  computedDisplay: "block",
  computedVisibility: "visible",
  isDisabled: false,
};

const DISABLED_HANDLE: HandleState = {
  computedDisplay: "block",
  computedVisibility: "visible",
  isDisabled: true,
};

const HIDDEN_HANDLE: HandleState = {
  computedDisplay: "none",
  computedVisibility: "visible",
  isDisabled: false,
};

function makeMockHandle(
  getState: () => HandleState,
): ActionableHandle {
  return {
    evaluate: (_fn: unknown, ..._args: unknown[]) =>
      Promise.resolve(getState()),
    dispose: () => Promise.resolve(),
  } as unknown as ActionableHandle;
}

function makeMockPage(opts: {
  waitForSelectorFn?: (
    selector: string,
    options?: { visible?: boolean; timeout?: number },
  ) => Promise<ActionableHandle | null>;
  handleState?: HandleState | (() => HandleState);
  /** If false, `page.$()` returns null (element not in DOM). Default: true. */
  elementExists?: boolean;
}): ActionablePage {
  const getState = (): HandleState => {
    if (typeof opts.handleState === "function") return opts.handleState();
    return opts.handleState ?? READY_HANDLE;
  };

  const exists = opts.elementExists ?? true;

  return {
    waitForSelector: opts.waitForSelectorFn ??
      (() => Promise.resolve(makeMockHandle(getState))),
    $: () =>
      exists
        ? Promise.resolve(makeMockHandle(getState))
        : Promise.resolve(null),
  } as unknown as ActionablePage;
}

// ---------------------------------------------------------------------------
// force: true
// ---------------------------------------------------------------------------

Deno.test("force: true returns immediately without calling evaluate", async () => {
  let handleCreated = false;
  const page = makeMockPage({
    handleState: () => {
      handleCreated = true;
      return READY_HANDLE;
    },
  });

  await waitForActionable(page, "#btn", { force: true });
  assertEquals(handleCreated, false);
});

// ---------------------------------------------------------------------------
// Happy path — already actionable
// ---------------------------------------------------------------------------

Deno.test("passes when element is visible and enabled", async () => {
  const page = makeMockPage({ handleState: READY_HANDLE });

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
      return Promise.resolve(makeMockHandle(() => READY_HANDLE));
    },
    handleState: READY_HANDLE,
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
    handleState: () => {
      evaluateCalls++;
      if (evaluateCalls <= 2) return DISABLED_HANDLE;
      return READY_HANDLE;
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
    elementExists: false,
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
    handleState: DISABLED_HANDLE,
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
    handleState: HIDDEN_HANDLE,
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
    elementExists: false,
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
    handleState: DISABLED_HANDLE,
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
      return Promise.resolve(makeMockHandle(() => READY_HANDLE));
    },
    handleState: READY_HANDLE,
  });

  await waitForActionable(page, "#btn", {
    timeout: 1000,
    checks: ["enabled"],
  });
  assertEquals(waitForSelectorCalled, false);
});
