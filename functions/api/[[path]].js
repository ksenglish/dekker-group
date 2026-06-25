// Cloudflare Pages Function — proxies all /api/* requests to the Render backend.
// This runs at the Cloudflare edge so the browser sees same-origin (pages.dev),
// keeping cookies and auth working without any CORS changes.

const BACKEND = 'https://dekker-group.onrender.com';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const targetUrl = `${BACKEND}${url.pathname}${url.search}`;

  const init = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  return fetch(targetUrl, init);
}
