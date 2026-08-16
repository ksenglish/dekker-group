import { useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import ProductImage from './ProductImage';
import { loadAuthedFile } from './authedFile';
import { htmlToText } from '../../lib/richText';
import { browseView } from './priceListTree';

// Browsing the price list the way a shop does: pick a category, then a
// subcategory, then look at the products. Used both as the Price List page's
// Browse view and, with onPick supplied, as the picker a quote opens.
//
// The whole active price list comes down in one request — a few hundred rows
// without their images is small, and having it all client-side makes search
// and drilling around instant. Pictures load per tile through ProductImage.

const money = cents => `$${(cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`;

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)', overflow: 'hidden', textAlign: 'left',
  cursor: 'pointer', padding: 0, width: '100%', fontFamily: 'inherit',
};

function FolderTile({ name, count, onClick }) {
  return (
    <button style={card} onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
      <div style={{
        height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8fafc', fontSize: 34,
      }}>📁</div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
          {count} product{count === 1 ? '' : 's'}
        </div>
      </div>
    </button>
  );
}

function ProductTile({ product, onOpen }) {
  return (
    <button style={card} onClick={() => onOpen(product)}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
      <div style={{
        height: 150, background: '#f8fafc',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {product.has_image
          ? <ProductImage productId={product.id} alt={product.name}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              fallback={<span style={{ fontSize: 30, opacity: 0.35 }}>🏷</span>} />
          : <span style={{ fontSize: 30, opacity: 0.35 }}>🏷</span>}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{product.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {product.unit_price > 0 ? money(product.unit_price) : 'POA'}
          </span>
          {product.unit && product.unit !== 'each' && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>per {product.unit}</span>
          )}
          {product.has_brochure && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>📄</span>
          )}
        </div>
      </div>
    </button>
  );
}

function ProductDetail({ product, onClose, onPick, picking }) {
  // The brochure is fetched with authentication like the pictures are — the
  // URL the server hands out needs a bearer token, which an <object data> or
  // <img src> can't send, and it carries no extension to tell a PDF from an
  // image. The blob's own MIME type settles both.
  const [brochure, setBrochure] = useState(null);
  const [brochureFailed, setBrochureFailed] = useState(false);
  const description = htmlToText(product.description);

  useEffect(() => {
    if (!product.has_brochure) return undefined;
    let cancelled = false;
    setBrochure(null); setBrochureFailed(false);
    loadAuthedFile(`/products/${product.id}/brochure`)
      .then(f => { if (!cancelled) setBrochure(f); })
      .catch(() => { if (!cancelled) setBrochureFailed(true); });
    return () => { cancelled = true; };
  }, [product.id, product.has_brochure]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--color-surface)', borderRadius: 12, width: 'min(920px, 100%)',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16, padding: '18px 22px', borderBottom: '1px solid var(--color-border)',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>{product.name}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3 }}>
              {[product.category, product.subcategory_1, product.subcategory_2].filter(Boolean).join(' › ') || 'Uncategorised'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 24, cursor: 'pointer',
            color: 'var(--color-text-muted)', lineHeight: 1,
          }} aria-label="Close">×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: product.has_image ? '260px 1fr' : '1fr', gap: 22, padding: 22 }}>
          {product.has_image && (
            <div style={{
              background: '#f8fafc', borderRadius: 8, height: 260,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <ProductImage productId={product.id} size="full" alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}

          <div>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>
              {product.unit_price > 0 ? money(product.unit_price) : 'Price on application'}
            </div>
            {/* Supplier is deliberately not shown — this view is used in front
                of customers and by the sales team. */}
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              excl. GST{product.unit && product.unit !== 'each' ? ` · per ${product.unit}` : ''}
            </div>

            {description && (
              <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text-muted)', marginBottom: 18 }}>
                {description}
              </p>
            )}

            {onPick && (
              <button onClick={() => onPick(product)} disabled={picking}
                style={{
                  padding: '11px 22px', background: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600,
                  cursor: picking ? 'default' : 'pointer', opacity: picking ? 0.7 : 1,
                }}>
                {picking ? 'Adding…' : '+ Add to Quote'}
              </button>
            )}
          </div>
        </div>

        {product.has_brochure && (
          <div style={{ padding: '0 22px 22px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Brochure</div>
              {brochure && (
                <a href={brochure.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12.5, color: 'var(--color-primary)' }}>
                  Open in a new tab
                </a>
              )}
            </div>

            {brochureFailed ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Couldn't load the brochure.</div>
            ) : !brochure ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
            ) : brochure.type.includes('pdf') ? (
              <object data={brochure.url} type="application/pdf"
                style={{ width: '100%', height: 520, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <a href={brochure.url} target="_blank" rel="noreferrer">Open the brochure</a>
              </object>
            ) : (
              <img src={brochure.url} alt={`${product.name} brochure`}
                style={{ width: '100%', borderRadius: 8, border: '1px solid var(--color-border)' }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PriceListBrowser({ onPick, onClose, title = 'Price List' }) {
  const [products, setProducts] = useState(null);
  const [path, setPath] = useState([]); // [category, subcategory_1, subcategory_2]
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setProducts(r.data)).catch(() => setProducts([]));
  }, []);

  const searching = search.trim().length > 1;

  const results = useMemo(() => {
    if (!products || !searching) return [];
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.supplier || '').toLowerCase().includes(q)
    ).slice(0, 200);
  }, [products, search, searching]);

  const view = useMemo(() => browseView(products, path), [products, path]);

  async function pick(product) {
    setPicking(true);
    try {
      await onPick(product);
      setOpen(null);
      setToast(`${product.name} added to quote`);
      setTimeout(() => setToast(null), 2600);
    } catch {
      setToast('Could not add that product — please try again.');
      setTimeout(() => setToast(null), 3200);
    } finally { setPicking(false); }
  }

  const crumbs = ['All products', ...path];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: onClose ? '16px 22px' : '0 0 16px',
        borderBottom: onClose ? '1px solid var(--color-border)' : 'none',
      }}>
        {onClose && <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>}

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products…"
          style={{
            flex: 1, minWidth: 220, maxWidth: 420, padding: '9px 12px',
            border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14,
          }}
        />

        {onClose && (
          <button onClick={onClose} style={{
            marginLeft: 'auto', padding: '9px 18px', background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}>Close</button>
        )}
      </div>

      {!searching && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: onClose ? '14px 22px 0' : '0 0 14px', fontSize: 13 }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: 'var(--color-text-muted)' }}>›</span>}
              {i === crumbs.length - 1
                ? <span style={{ fontWeight: 600 }}>{c}</span>
                : <button onClick={() => setPath(path.slice(0, i))} style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--color-primary)', fontSize: 13, fontFamily: 'inherit',
                  }}>{c}</button>}
            </span>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: onClose ? '18px 22px 22px' : '0' }}>
        {products === null ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading price list…</div>
        ) : products.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            No products yet — import a price list to get started.
          </div>
        ) : searching ? (
          results.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Nothing matches “{search}”.</div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                {results.length} match{results.length === 1 ? '' : 'es'}
              </div>
              <div style={grid}>
                {results.map(p => <ProductTile key={p.id} product={p} onOpen={setOpen} />)}
              </div>
            </>
          )
        ) : (
          <div style={grid}>
            {view.folders.map(f => (
              <FolderTile key={f.name} name={f.name} count={f.items.length}
                onClick={() => setPath([...path, f.name])} />
            ))}
            {view.items.map(p => <ProductTile key={p.id} product={p} onOpen={setOpen} />)}
          </div>
        )}
      </div>

      {open && (
        <ProductDetail product={open} onClose={() => setOpen(null)}
          onPick={onPick ? pick : null} picking={picking} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '11px 20px', borderRadius: 8,
          fontSize: 14, fontWeight: 600, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>{toast}</div>
      )}
    </div>
  );
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
  gap: 16,
};
