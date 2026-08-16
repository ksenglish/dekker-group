import { useEffect, useState } from 'react';
import { loadAuthedFile, cachedAuthedFile } from './authedFile';

// A product picture, fetched with authentication (see authedFile).
// `fallback` is rendered whenever there's nothing to show — a missing file, a
// failed request, or bytes the browser can't decode — so a tile shows its
// placeholder rather than a broken-image glyph.
export default function ProductImage({ productId, size = 'thumb', alt = '', className, style, fallback = null }) {
  const path = size === 'full' ? `/products/${productId}/media` : `/products/${productId}/thumb`;
  const [url, setUrl] = useState(() => cachedAuthedFile(path)?.url || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    const cached = cachedAuthedFile(path);
    if (cached) { setUrl(cached.url); return undefined; }

    setUrl(null);
    loadAuthedFile(path)
      .then(f => { if (!cancelled) setUrl(f.url); })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [path]);

  if (failed) return fallback;
  if (!url) return <div className={className} style={{ ...style, background: '#f1f5f9' }} />;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      // Bytes that arrived but won't decode land here rather than leaving the
      // browser's broken-image icon sitting in the grid.
      onError={() => setFailed(true)}
    />
  );
}
