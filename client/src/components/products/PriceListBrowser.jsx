import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import ProductImage from './ProductImage';
import { loadAuthedFile } from './authedFile';
import { htmlToText } from '../../lib/richText';
import { browseView, LEVELS, showsGstInclusive } from './priceListTree';
import styles from './PriceListBrowser.module.css';

// Browsing the price list the way a shop does: pick a category, then a
// subcategory, then look at the products. Used both as the Price List page's
// Browse view and, with onPick supplied, as the picker a quote opens.
//
// The whole active price list comes down in one request — a few hundred rows
// without their images is small, and having it all client-side makes search
// and drilling around instant. Pictures load per tile through ProductImage.

const GST_RATE = 0.15;

const money = cents =>
  `$${(cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Prices are stored excluding GST. Some categories are quoted to customers
// inclusive of it — see showsGstInclusive — so the figure and the label that
// goes with it are worked out together and never drift apart.
const priceOf = (product) => {
  const inclusive = showsGstInclusive(product);
  return {
    text: money(inclusive ? product.unit_price * (1 + GST_RATE) : product.unit_price),
    label: inclusive ? 'incl. GST' : 'excl. GST',
  };
};

// Big enough to feel like a full page of a catalogue, small enough that a
// thousand-product category doesn't try to render at once.
const PAGE_SIZE = 48;

// Laid out as a column filling its grid cell, so every tile in a row ends at
// the same line however long its description is. Without this the cards come
// out ragged, which shows badly at four across.
const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)', overflow: 'hidden', textAlign: 'left',
  cursor: 'pointer', padding: 0, width: '100%', height: '100%',
  fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
};

function FolderTile({ name, count, onClick }) {
  return (
    <button style={card} onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
      <div style={{
        height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8fafc', fontSize: 42,
      }}>📁</div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3 }}>
          {count} product{count === 1 ? '' : 's'}
        </div>
      </div>
    </button>
  );
}

function ProductTile({ product, onOpen }) {
  // Descriptions hold rich text, so the markup is flattened rather than shown
  // as literal tags.
  const description = htmlToText(product.description).trim();
  return (
    <button style={card} onClick={() => onOpen(product)} title={product.name}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
      <div style={{
        height: 210, flexShrink: 0, background: '#f8fafc',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {product.has_image
          ? <ProductImage productId={product.id} alt={product.name}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              fallback={<span style={{ fontSize: 38, opacity: 0.35 }}>🏷</span>} />
          : <span style={{ fontSize: 38, opacity: 0.35 }}>🏷</span>}
      </div>
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* The name leads, because it is what tells one product from another.
            A supplier's price list sells the same gate in ninety-nine sizes,
            and every one of those carries the identical marketing paragraph —
            led by the description they were ninety-nine tiles reading the same
            words, with nothing on screen to say which size was which.

            Clamped rather than truncated mid-word, so every tile in a row
            stays the same height. */}
        <div style={{
          fontSize: 14, fontWeight: 600, lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', overflowWrap: 'anywhere',
        }}>{product.name}</div>
        {description && (
          <div style={{
            fontSize: 12.5, lineHeight: 1.45, color: 'var(--color-text-muted)', marginTop: 4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{description}</div>
        )}
        {/* Pinned to the bottom, so the prices line up across a row rather
            than floating wherever the description happens to end. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>
            {product.unit_price > 0 ? priceOf(product).text : 'POA'}
          </span>
          {product.unit_price > 0 && (
            // Which categories are inclusive varies, so the tile says which
            // this one is rather than leaving it to be assumed.
            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{priceOf(product).label}</span>
          )}
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

// Whether this is a phone-width screen, watched rather than read once — a
// tablet turned on its side changes the answer, and the layout should follow.
//
// Only used where the difference is what gets rendered at all, not how it
// looks; anything that is purely appearance belongs in the stylesheet.
function useNarrowScreen(query = '(max-width: 639px)') {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

function ProductDetail({ product, onClose, onPick, picking }) {
  const narrow = useNarrowScreen();
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
    <div className={styles.detailOverlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={styles.detailCard}>
        <div className={styles.detailHead}>
          <div style={{ minWidth: 0 }}>
            {/* minWidth:0 so a long product name wraps instead of forcing the
                row wider than the sheet and pushing the close button off. */}
            <h2 style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{product.name}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3 }}>
              {LEVELS.map(l => product[l]).filter(Boolean).join(' › ') || 'Uncategorised'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 28, cursor: 'pointer',
            color: 'var(--color-text-muted)', lineHeight: 1,
            // A comfortable target on a phone — the 24px glyph alone was a
            // small thing to hit with a thumb.
            padding: 4, margin: -4, flexShrink: 0,
          }} aria-label="Close">×</button>
        </div>

        <div className={`${styles.detailBody} ${product.has_image ? styles.detailBodyWithImage : ''}`}>
          {product.has_image && (
            <div className={styles.detailImage}>
              <ProductImage productId={product.id} size="full" alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}

          <div>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>
              {product.unit_price > 0 ? priceOf(product).text : 'Price on application'}
            </div>
            {/* Supplier is deliberately not shown — this view is used in front
                of customers and by the sales team. */}
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              {priceOf(product).label}{product.unit && product.unit !== 'each' ? ` · per ${product.unit}` : ''}
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
              // On a phone this was a 520px slab of empty grey. iOS will not
              // render a PDF inside an <object> at all, and even where it does
              // work a viewer that tall buries everything under it. A button
              // that opens the file in the device's own viewer is both smaller
              // and the thing people actually want.
              narrow ? (
                <a href={brochure.url} target="_blank" rel="noreferrer"
                  style={{
                    display: 'block', textAlign: 'center', padding: '13px 16px',
                    border: '1px solid var(--color-border)', borderRadius: 8,
                    background: '#f8fafc', color: 'var(--color-primary)',
                    fontSize: 14, fontWeight: 600, textDecoration: 'none',
                  }}>
                  📄 Open the brochure
                </a>
              ) : (
                <object data={brochure.url} type="application/pdf"
                  style={{ width: '100%', height: 520, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                  <a href={brochure.url} target="_blank" rel="noreferrer">Open the brochure</a>
                </object>
              )
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

// `inUrl` puts the folder you are looking at into the address bar, so the
// browser's own Back button steps up a level instead of leaving the price list
// altogether — which is what it did, after four taps into a category.
//
// Only the Price List page asks for it. The same component is also the picker
// inside a quote, where it is a panel over the quote's own page: writing to
// the URL there would rewrite the quote's address and make Back mean something
// else entirely.
export default function PriceListBrowser({ onPick, onClose, title = 'Price List', inUrl = false }) {
  const [products, setProducts] = useState(null);
  const navigate = useNavigate();
  const [localPath, setLocalPath] = useState([]); // [category, subcategory_1, …]
  const [localOpen, setLocalOpen] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // One folder name per `c`, repeated — rather than one joined string, because
  // a category is free text and nothing stops it containing whatever separator
  // we picked.
  const urlPath = useMemo(() => searchParams.getAll('c'), [searchParams]);
  const path = inUrl ? urlPath : localPath;

  const setPath = next => {
    if (!inUrl) { setLocalPath(next); return; }
    const params = new URLSearchParams(searchParams);
    params.delete('c');
    next.forEach(c => params.append('c', c));
    // A product sheet belongs to the folder it was opened from, not to the
    // one being moved to.
    params.delete('p');
    // Pushed, not replaced: each step down is a step Back can undo.
    setSearchParams(params);
  };

  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get('/products').then(r => setProducts(r.data)).catch(() => setProducts([]));
  }, []);

  // The open product is in the address too, so Back closes the sheet rather
  // than jumping out of the price list — on a phone the sheet covers the
  // screen, and closing it is exactly what Back is reached for.
  //
  // Held as an id and looked up, so a reload or a shared link opens the same
  // product rather than a blank sheet.
  const openId = inUrl ? searchParams.get('p') : null;
  const open = inUrl
    ? (openId ? (products || []).find(p => String(p.id) === openId) || null : null)
    : localOpen;

  // Whether opening the sheet is a step this page took, as opposed to the
  // address somebody was handed with a product already in it.
  const pushedOpenRef = useRef(false);

  const setOpen = next => {
    if (!inUrl) { setLocalOpen(next); return; }
    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set('p', String(next.id));
      pushedOpenRef.current = true;
      setSearchParams(params);
      return;
    }
    // Closing with the ✕ undoes the step that opened it, rather than adding
    // another one — otherwise Back from a closed sheet re-opens it.
    if (pushedOpenRef.current) {
      pushedOpenRef.current = false;
      navigate(-1);
      return;
    }
    // Opened straight from a link: there is nothing behind it to go back to,
    // so take the product out of the address without leaving a step either.
    params.delete('p');
    setSearchParams(params, { replace: true });
  };

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

  // Whatever is being listed right now — search hits, or the products in this
  // folder. Folders themselves aren't paged; there are never many at a level.
  const listed = searching ? results : view.items;
  const totalPages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const pageItems = listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Moving folder or changing the search starts again at the first page —
  // otherwise you can land on page 4 of a category that only has one.
  useEffect(() => { setPage(1); }, [path, search]);

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
        ) : searching && results.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Nothing matches “{search}”.</div>
        ) : (
          <>
            {listed.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                {searching
                  ? `${listed.length} match${listed.length === 1 ? '' : 'es'}`
                  : `${listed.length} product${listed.length === 1 ? '' : 's'}`}
                {totalPages > 1 && ` · showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, listed.length)}`}
              </div>
            )}

            <div className={styles.grid}>
              {!searching && view.folders.map(f => (
                <FolderTile key={f.name} name={f.name} count={f.items.length}
                  onClick={() => setPath([...path, f.name])} />
              ))}
              {pageItems.map(p => <ProductTile key={p.id} product={p} onOpen={setOpen} />)}
            </div>

            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 14, marginTop: 24, fontSize: 13.5,
              }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  style={pagerBtn(page === 1)}>← Prev</button>
                <span style={{ color: 'var(--color-text-muted)' }}>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  style={pagerBtn(page === totalPages)}>Next →</button>
              </div>
            )}
          </>
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

const pagerBtn = disabled => ({
  padding: '7px 16px', borderRadius: 6, fontSize: 13.5, fontWeight: 600,
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
});
