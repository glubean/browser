/**
 * Local HTTP server for actionability integration tests.
 *
 * Each endpoint serves a page with precisely controlled timing behavior
 * so tests can verify that auto-waiting actually waited.
 */

function html(body: string): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}

function handler(req: Request): Response {
  const path = new URL(req.url).pathname;

  switch (path) {
    // Button hidden for 600ms, then becomes visible
    case "/delayed-button":
      return html(`
        <button id="btn" style="display:none">Click me</button>
        <script>setTimeout(() => document.getElementById('btn').style.display = 'block', 600)</script>
      `);

    // Input disabled for 800ms, then enabled
    case "/disabled-form":
      return html(`
        <input id="email" type="email" disabled placeholder="email" />
        <script>setTimeout(() => document.getElementById('email').disabled = false, 800)</script>
      `);

    // Button permanently hidden (for timeout testing)
    case "/never-visible":
      return html(`
        <button id="btn" style="display:none">Ghost</button>
      `);

    // Button visible and enabled immediately
    case "/already-ready":
      return html(`
        <button id="btn">Ready</button>
        <input id="email" type="email" placeholder="email" />
      `);

    default:
      return new Response("Not found", { status: 404 });
  }
}

export function startTestServer(): { url: string; close: () => Promise<void> } {
  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => server.shutdown(),
  };
}
