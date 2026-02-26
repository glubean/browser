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

    // SPA-style: link click triggers pushState after 500ms
    case "/spa-navigation":
      return html(`
        <a id="link" href="#">Go to /dashboard</a>
        <script>
          document.getElementById('link').addEventListener('click', (e) => {
            e.preventDefault();
            setTimeout(() => history.pushState({}, '', '/dashboard'), 500);
          });
        </script>
      `);

    // Heading text changes from "Loading..." to "Welcome" after 600ms
    case "/delayed-text":
      return html(`
        <h1 id="heading">Loading...</h1>
        <script>setTimeout(() => document.getElementById('heading').textContent = 'Welcome', 600)</script>
      `);

    // Attribute changes from data-status="pending" to "ready" after 500ms
    case "/delayed-attr":
      return html(`
        <div id="box" data-status="pending">Box</div>
        <script>setTimeout(() => document.getElementById('box').setAttribute('data-status', 'ready'), 500)</script>
      `);

    // Starts with 1 <li>, adds 2 more after 500ms
    case "/delayed-list":
      return html(`
        <ul id="list"><li>Item 1</li></ul>
        <script>setTimeout(() => {
          const ul = document.getElementById('list');
          ul.innerHTML += '<li>Item 2</li><li>Item 3</li>';
        }, 500)</script>
      `);

    // Element visible initially, hidden after 500ms
    case "/hide-after-delay":
      return html(`
        <div id="el" style="padding:10px">Visible for now</div>
        <script>setTimeout(() => document.getElementById('el').style.display = 'none', 500)</script>
      `);

    // Button targeted by aria-label, hidden for 600ms then visible
    case "/aria-button":
      return html(`
        <button aria-label="Submit form" style="display:none">Go</button>
        <script>setTimeout(() => document.querySelector('button').style.display = 'block', 600)</script>
      `);

    // Button targeted by text content, disabled for 600ms then enabled
    case "/text-button":
      return html(`
        <button disabled>Continue</button>
        <script>setTimeout(() => document.querySelector('button').disabled = false, 600)</script>
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
