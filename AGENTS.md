# @glubean/browser — AI Agent Guidelines

## Codebase Context

This is an independent Glubean plugin for browser automation, built on
puppeteer-core.

- **Runtime:** Deno (TypeScript)
- **Dependency:** `puppeteer-core` (npm), `@glubean/sdk` (JSR, peer dependency)
- **Transport:** Connect-only — no bundled browser binary. Requires a remote
  Chrome instance.

## Code Standards

- All code comments and documentation in English.
- TypeScript strict mode.
- Only depend on `@glubean/sdk` public exports (`definePlugin` from `/plugin`,
  types from root).
- No internal SDK imports.

## Git Workflow — Strict GitHub Flow

1. Never commit directly to `main`.
2. Create a feature branch for every unit of work.
3. Open a Pull Request before merging.
4. Ask for explicit permission before every git operation.

## Plugin Architecture

The plugin uses `definePlugin()` from `@glubean/sdk/plugin` to integrate with
the Glubean test runner. It connects to a remote Chrome instance via WebSocket
and returns a `GlubeanPage` wrapper that auto-emits trace events, performance
metrics, and console log forwarding.

See the SDK plugin docs at https://jsr.io/@glubean/sdk for the `GlubeanRuntime`
interface contract.
