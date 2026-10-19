import { useRef, useState, useEffect } from 'react';
import { compressImage } from '../../lib/image';
import { fetchAuthedObjectUrl } from './authedFile';
import styles from '../../pages/products/Products.module.css';

// The product image and brochure pickers, shared by the Price List's own
// Add/Edit Product form and the quick "Add to Price List" popup on a proposal,
// so the two look and behave identically.

// A value that can go straight into an <img src>: a file just picked, or one
// stored inline on the product. The MIME type comes off the front of it.
function direct(v) {
  if (!/^(data|blob):/.test(v || '')) return null;
  const m = /^data:([^;,]+)/.exec(v);
  return { src: v, type: m ? m[1] : '' };
}

// media_url and brochure_url arrive as "/api/products/<id>/media"; the API
// client is already rooted at /api.
const apiPath = v => String(v).replace(/^\/api(?=\/)/, '');

// What to actually show for a value, and what kind of file it turned out to be.
//
// A product whose file lives in the bucket carries a path here, not the bytes.
// That path cannot go into an <img src>: the API wants a bearer token, which
// an <img> cannot send, so every such preview came up broken — and a stored
// PDF brochure, having no "data:application/pdf" prefix to recognise, was
// drawn as an image rather than named as a PDF. The bytes come through the
// API client instead, and the type comes off the response rather than off the
// string.
function useFilePreview(value) {
  const [fetched, setFetched] = useState(null);
  const shown = direct(value);

  useEffect(() => {
    if (!value || direct(value)) { setFetched(null); return undefined; }
    let live = true;
    let objectUrl = null;
    setFetched({ loading: true });
    fetchAuthedObjectUrl(apiPath(value))
      .then(f => {
        objectUrl = f.url;
        if (live) setFetched({ src: f.url, type: f.type });
        else URL.revokeObjectURL(f.url);
      })
      .catch(() => { if (live) setFetched({ failed: true }); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [value]);

  if (!value) return null;
  return shown || fetched || { loading: true };
}

// Shown in place of the picture while its bytes are on the way, or if they
// never arrive — an empty frame would read as "there is no image", which is
// the one thing it does not mean.
function PreviewFallback({ state, noun }) {
  return (
    <div className={styles.previewPlaceholder}>
      {state.failed ? `Couldn\u2019t load this ${noun}` : `Loading the ${noun}\u2026`}
    </div>
  );
}

export function ImageUpload({ value, onChange }) {
  const ref = useRef();
  const preview = useFilePreview(value);

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      return alert('Please upload a JPG or PNG image.');
    // Downscale first — the limit is on what gets stored, not the raw file.
    const { dataUrl, bytes } = await compressImage(file);
    if (bytes > 2 * 1024 * 1024)
      return alert('Image must be under 2MB.');
    onChange(dataUrl);
  }

  return (
    <div className={styles.imageUpload}>
      {value ? (
        <div className={styles.imagePreviewWrap}>
          {preview?.src
            ? <img src={preview.src} alt="Product" className={styles.imagePreview} />
            : <PreviewFallback state={preview || {}} noun="image" />}
          <button type="button" className={styles.imageRemove} onClick={() => onChange('')}>✕ Remove</button>
        </div>
      ) : (
        <button type="button" className={styles.imagePickBtn} onClick={() => ref.current.click()}>
          📷 Upload Image (JPG / PNG)
        </button>
      )}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

export function BrochureUpload({ value, onChange }) {
  const ref = useRef();
  const preview = useFilePreview(value);

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type))
      return alert('Please upload a JPG, PNG, or PDF.');
    // PDFs pass through compressImage untouched.
    const { dataUrl, bytes } = await compressImage(file);
    if (bytes > 10 * 1024 * 1024)
      return alert('Brochure must be under 10MB.');
    onChange(dataUrl);
  }

  // From the file itself rather than from the front of the string, so a PDF
  // stored in the bucket is named as one instead of being drawn as an image.
  const isPdf = preview?.type === 'application/pdf';

  return (
    <div className={styles.imageUpload}>
      {value ? (
        <div className={styles.imagePreviewWrap}>
          {isPdf
            ? <div style={{ padding: '10px 16px', background: '#f1f5f9', borderRadius: 6, fontSize: 13, color: '#334155' }}>📄 PDF brochure uploaded</div>
            : preview?.src
            ? <img src={preview.src} alt="Brochure preview" className={styles.imagePreview} style={{ maxHeight: 120 }} />
            : <PreviewFallback state={preview || {}} noun="brochure" />
          }
          <button type="button" className={styles.imageRemove} onClick={() => onChange('')}>✕ Remove</button>
        </div>
      ) : (
        <button type="button" className={styles.imagePickBtn} onClick={() => ref.current.click()}>
          📄 Upload Brochure (PDF, JPG or PNG — max 10MB)
        </button>
      )}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

export const PRODUCT_UNITS = ['each', 'hr', 'm', 'm²', 'm³', 'kg', 'L', 'day', 'kit', 'set'];
