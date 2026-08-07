// Cloudflare Pages Function — guards /assets/* against the SPA fallback.
//
// _redirects ends with `/* /index.html 200`, so a request for a hashed bundle
// that no longer exists (an old tab, or a service worker holding a previous
// build's precache) came back as index.html with a 200. The browser rejected
// that HTML as CSS on MIME grounds and rendered the app unstyled, and the
// service worker cached the HTML *as* the stylesheet, so it stayed broken.
//
// This cannot be fixed in _redirects: Cloudflare Pages only supports 301/302/
// 303/307/308 and 200 rewrites there, so a `404` rule is silently ignored.
// Hence this Function, which serves the asset normally and turns a fallback
// into a real 404 so the failure is loud and nothing poisonous gets cached.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const response = await env.ASSETS.fetch(request);

  // Hashed build output is only ever CSS or JS. Getting HTML back means the
  // file is gone and the SPA fallback answered in its place.
  const isBundle = /\.(css|js)$/i.test(url.pathname);
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');

  if (isBundle && isHtml) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return response;
}
