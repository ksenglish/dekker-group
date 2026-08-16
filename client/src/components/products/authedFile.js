import api from '../../lib/api';

// Product images and brochures sit behind the same authentication as
// everything else, and an <img src> or <object data> can't send a bearer
// token — so the bytes come through the API client and become an object URL.
//
// Results are cached for the life of the page, and in-flight requests are
// shared, so a grid of forty tiles makes one request per file rather than
// forty for the same picture.
const cache = new Map();   // path -> { url, type }
const pending = new Map(); // path -> Promise<{ url, type }>

export function loadAuthedFile(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  if (pending.has(path)) return pending.get(path);

  const request = api.get(path, { responseType: 'blob' })
    .then(res => {
      const blob = res.data;
      // The blob's own type is what decides how to display it — the URL has no
      // extension to go on, and a brochure is as likely to be an image as a PDF.
      const entry = { url: URL.createObjectURL(blob), type: blob.type || '' };
      cache.set(path, entry);
      return entry;
    })
    .finally(() => pending.delete(path));

  pending.set(path, request);
  return request;
}

export const cachedAuthedFile = path => cache.get(path) || null;
