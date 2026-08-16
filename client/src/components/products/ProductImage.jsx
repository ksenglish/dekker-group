import { useEffect, useState } from 'react';
import api from '../../lib/api';

// Product images sit behind the same authentication as everything else, and an
// <img src> can't send a bearer token — so the bytes are fetched through the
// API client and turned into an object URL.
//
// URLs are cached for the life of the page: a grid re-rendering, or the same
// product opening in the detail view, reuses what was already fetched instead
// of asking again. In-flight requests are cached too, so forty tiles mounting
// at once can't fire forty duplicate requests for the same picture.
const cache = new Map();   // key -> object URL
const pending = new Map(); // key -> Promise<object URL>

function load(productId, size) {
  const key = `${productId}:${size}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);

  const path = size === 'full' ? `/products/${productId}/media` : `/products/${productId}/thumb`;
  const request = api.get(path, { responseType: 'blob' })
    .then(res => {
      const url = URL.createObjectURL(res.data);
      cache.set(key, url);
      return url;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

export default function ProductImage({ productId, size = 'thumb', alt = '', className, style, fallback = null }) {
  const [url, setUrl] = useState(() => cache.get(`${productId}:${size}`) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const cached = cache.get(`${productId}:${size}`);
    if (cached) { setUrl(cached); return undefined; }

    setUrl(null);
    load(productId, size)
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [productId, size]);

  if (failed || (!url && fallback)) return fallback;
  if (!url) return <div className={className} style={{ ...style, background: '#f1f5f9' }} />;
  return <img src={url} alt={alt} className={className} style={style} />;
}
