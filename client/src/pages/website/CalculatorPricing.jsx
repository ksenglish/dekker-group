import { useEffect, useState } from 'react';
import api from '../../lib/api';

// The "Installation from" figures the website calculators quote.
//
// It's the same field as the one in Presenter Setup — this is a second way in,
// so the numbers that appear on dekkerair.co.nz can be set from the Website
// section without hunting through the presenter catalogue for each product.
//
// Only products whose calculator drives a website page are listed; a fixed-price
// product has nothing to quote an install figure against.
const WEBSITE_CALCULATORS = {
  heatpump: 'Heat pumps — /heating',
  smartvent_lite: 'Ventilation — /ventilation/positive-pressure',
  smartvent_positive_pressure: 'Ventilation — /ventilation/positive-pressure',
  bdvair_positive_pressure: 'Ventilation — /ventilation/positive-pressure',
  smartvent_balanced_pressure: 'Ventilation — /ventilation/balanced-pressure',
  paling_fence: 'Fencing',
};

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
};

export default function CalculatorPricing() {
  const [products, setProducts] = useState(null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const { data: sections } = await api.get('/presenter/sections');
      const lists = await Promise.all(
        sections.map(s => api.get(`/presenter/sections/${s.id}/products`).then(r => r.data))
      );
      const all = lists.flat().filter(p => WEBSITE_CALCULATORS[p.calculator_type]);
      setProducts(all);
    } catch {
      setError('Could not load the calculator products');
    }
  }

  useEffect(() => { load(); }, []);

  async function save(product) {
    const raw = edits[product.id];
    setSaving(product.id); setError(null);
    try {
      await api.put(`/presenter/products/${product.id}`, {
        ...product,
        install_from_cents: raw === '' ? null : Math.round(parseFloat(raw) * 100),
      });
      setFlash(`Saved — ${product.name}`);
      setTimeout(() => setFlash(null), 2600);
      setEdits(e => { const n = { ...e }; delete n[product.id]; return n; });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that price');
    } finally { setSaving(null); }
  }

  if (!products) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{error || 'Loading…'}</div>;
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: 18, maxWidth: 720 }}>
        Product prices on the website are supply only. These are the
        &ldquo;Installation from&rdquo; figures shown alongside them. They&rsquo;re the same
        values as the Installation From field in Presenter Setup — set them in
        either place. Enter the price <strong>excluding GST</strong>; the website
        adds it. Leave one blank to fall back to the install product&rsquo;s own rate.
      </p>

      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {flash && <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{flash}</div>}

      {products.length === 0 ? (
        <div style={{ ...card, padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No products use a website calculator yet. Set a Calculator Type in Presenter Setup first.
        </div>
      ) : products.map(p => {
        const stored = p.install_from_cents != null ? (p.install_from_cents / 100).toFixed(2) : '';
        const value = edits[p.id] ?? stored;
        const dirty = edits[p.id] !== undefined && edits[p.id] !== stored;

        return (
          <div key={p.id} style={{ ...card, padding: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {WEBSITE_CALCULATORS[p.calculator_type]}
                {p.install_product ? ` · install item: ${p.install_product.name}` : ' · no install item linked'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>$</span>
              <input type="number" min="0" step="0.01" value={value}
                onChange={e => setEdits(x => ({ ...x, [p.id]: e.target.value }))}
                placeholder="not set"
                style={{ width: 130, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14 }} />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>ex GST</span>
            </div>

            <button onClick={() => save(p)} disabled={!dirty || saving === p.id}
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 13.5, fontWeight: 600,
                background: dirty ? 'var(--color-primary)' : 'var(--color-surface)',
                color: dirty ? '#fff' : 'var(--color-text-muted)',
                border: dirty ? 'none' : '1px solid var(--color-border)',
                cursor: dirty ? 'pointer' : 'default',
              }}>
              {saving === p.id ? 'Saving…' : 'Save'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
