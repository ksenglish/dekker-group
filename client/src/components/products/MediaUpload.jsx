import { useRef } from 'react';
import { compressImage } from '../../lib/image';
import styles from '../../pages/products/Products.module.css';

// The product image and brochure pickers, shared by the Price List's own
// Add/Edit Product form and the quick "Add to Price List" popup on a proposal,
// so the two look and behave identically.

export function ImageUpload({ value, onChange }) {
  const ref = useRef();

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
          <img src={value} alt="Product" className={styles.imagePreview} />
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

  const isPdf = value?.startsWith('data:application/pdf');

  return (
    <div className={styles.imageUpload}>
      {value ? (
        <div className={styles.imagePreviewWrap}>
          {isPdf
            ? <div style={{ padding: '10px 16px', background: '#f1f5f9', borderRadius: 6, fontSize: 13, color: '#334155' }}>📄 PDF brochure uploaded</div>
            : <img src={value} alt="Brochure preview" className={styles.imagePreview} style={{ maxHeight: 120 }} />
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

export const PRODUCT_UNITS = ['each', 'hr', 'm', 'm²', 'kg', 'L', 'day', 'kit', 'set'];
