import { useState } from 'react';
import api from '../../lib/api';
import styles from './Jobs.module.css';

// The costs on a job, grouped under the supplier document each line came off.
//
// A flat list of forty lines says nothing about which invoice they belong to,
// and gives nobody a way to check a line against the document it was read from.
// So each document gets a card — supplier, date, what it came to — with the PDF
// one click away and its lines underneath, the same shape as the Invoice Inbox.
//
// Admin can correct what the scanner read wrong: a mangled description, a
// quantity off by one, a line it missed, or a credit that came through as a
// cost.

const GST_RATE = 0.15;
// A credit reads "-$48.36", not "$-48.36" — the minus belongs in front.
const money = n => `${(n || 0) < 0 ? '-' : ''}$${Math.abs(n || 0).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
// A DATE column comes back as 2026-09-29 or as an ISO timestamp; <input type=date>
// wants the first ten characters of either.
const dateInput = d => (d ? String(d).slice(0, 10) : '');

function lineTotalEx(c) { return (c.unit_price / 100) * c.quantity; }
function sumEx(items) { return items.reduce((s, c) => s + lineTotalEx(c), 0); }

// ── One document and its lines ────────────────────────────────────────────────

function DocumentCard({ jobId, scan, items, canEdit, onChanged, onScanDeleted, fetchDoc }) {
  const [showDoc, setShowDoc] = useState(false);
  const [docUrl, setDocUrl] = useState(null);
  const [docError, setDocError] = useState('');
  const [editing, setEditing] = useState(null);    // draft rows while editing lines
  const [savingItems, setSavingItems] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [editHead, setEditHead] = useState(null);  // draft supplier/number/date
  const [savingHead, setSavingHead] = useState(false);
  const [busy, setBusy] = useState(false);

  const isCredit = scan ? scan.document_type === 'credit_note' : sumEx(items) < 0;
  const total = sumEx(items);
  const isPdf = (scan?.mime_type || '').includes('pdf');

  async function togglePdf() {
    if (showDoc) { setShowDoc(false); return; }
    setShowDoc(true);
    if (docUrl) return;
    try { setDocUrl(await fetchDoc(scan.id)); } catch { setDocError('That document could not be opened.'); }
  }

  function startEditing() {
    setItemsError('');
    setEditing(items.map(c => ({
      id: c.id,
      description: c.description,
      quantity: String(c.quantity),
      // Edited ex-GST, which is how it is stored. A credit keeps its minus sign.
      unit_price: (c.unit_price / 100).toFixed(2),
    })));
  }

  function setRow(i, field, value) {
    setEditing(rows => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  async function saveItems() {
    for (const r of editing) {
      if (!r.description.trim()) { setItemsError('Every line needs a description.'); return; }
      if (!(parseFloat(r.quantity) > 0)) { setItemsError('Every quantity must be more than zero.'); return; }
      if (!Number.isFinite(parseFloat(r.unit_price))) { setItemsError('Every unit price must be a number.'); return; }
    }
    setSavingItems(true); setItemsError('');
    try {
      // Removed lines go first, then edits, then additions — so a line deleted
      // and a line added in the same pass don't fight over a sort order.
      const kept = new Set(editing.filter(r => r.id).map(r => r.id));
      for (const c of items) {
        if (!kept.has(c.id)) await api.delete(`/jobs/${jobId}/costs/${c.id}`);
      }
      for (const r of editing) {
        const before = items.find(c => c.id === r.id);
        const body = {
          description: r.description.trim(),
          quantity: parseFloat(r.quantity),
          unit_price: parseFloat(r.unit_price),
        };
        if (!before) {
          await api.post(`/jobs/${jobId}/cost-scans/${scan.id}/costs`, body);
        } else if (before.description !== body.description
            || Number(before.quantity) !== body.quantity
            || before.unit_price !== Math.round(body.unit_price * 100)) {
          await api.put(`/jobs/${jobId}/costs/${r.id}`, body);
        }
      }
      setEditing(null);
      await onChanged();
    } catch (e) {
      setItemsError(e.response?.data?.error || 'Those changes could not be saved.');
    } finally { setSavingItems(false); }
  }

  async function saveHead() {
    setSavingHead(true);
    try {
      await api.patch(`/jobs/${jobId}/cost-scans/${scan.id}`, editHead);
      setEditHead(null);
      await onChanged();
    } finally { setSavingHead(false); }
  }

  async function deleteDocument() {
    const n = items.length;
    if (!confirm(`Remove this ${isCredit ? 'credit note' : 'invoice'} and the ${n} cost line${n === 1 ? '' : 's'} it brought in? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/jobs/${jobId}/cost-scans/${scan.id}`);
      onScanDeleted(scan.id);
    } finally { setBusy(false); }
  }

  return (
    <div className={`${styles.costDoc} ${isCredit ? styles.costDocCredit : ''}`}>
      <div className={styles.costDocHead}>
        {editHead ? (
          <div className={styles.costDocHeadEdit}>
            <input value={editHead.supplier} placeholder="Supplier"
              onChange={e => setEditHead(h => ({ ...h, supplier: e.target.value }))} />
            <input value={editHead.invoice_number} placeholder="Invoice number"
              onChange={e => setEditHead(h => ({ ...h, invoice_number: e.target.value }))} />
            <input type="date" value={editHead.invoice_date}
              onChange={e => setEditHead(h => ({ ...h, invoice_date: e.target.value }))} />
            <select value={editHead.document_type}
              onChange={e => setEditHead(h => ({ ...h, document_type: e.target.value }))}>
              <option value="invoice">Invoice</option>
              <option value="credit_note">Credit note</option>
            </select>
            <button className={styles.btnSmallPrimary} onClick={saveHead} disabled={savingHead}>
              {savingHead ? 'Saving…' : 'Save'}
            </button>
            <button className={styles.btnSmall} onClick={() => setEditHead(null)}>Cancel</button>
          </div>
        ) : (
          <>
            <div className={styles.costDocWho}>
              <span className={styles.costDocSupplier}>
                {scan ? (scan.supplier || 'Supplier not read') : 'Added by hand'}
                {isCredit && <em className={styles.costDocTag}>Credit note</em>}
              </span>
              <span className={styles.costDocMeta}>
                {[
                  scan
                    ? (fmtDate(scan.invoice_date) || `uploaded ${fmtDate(scan.created_at)}`)
                    : 'No supplier document',
                  scan?.invoice_number && `#${scan.invoice_number}`,
                  `${items.length} line${items.length === 1 ? '' : 's'}`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className={`${styles.costDocTotal} ${total < 0 ? styles.costNegative : ''}`}>
              {money(total)}<em> ex-GST</em>
            </span>
            <div className={styles.costDocActions}>
              {scan?.has_document && (
                <button className={styles.btnSmall} onClick={togglePdf}>
                  {showDoc ? (isPdf ? 'Hide PDF' : 'Hide document') : (isPdf ? 'View PDF' : 'View document')}
                </button>
              )}
              {canEdit && (
                <button className={styles.btnSmall} onClick={startEditing}>Edit lines</button>
              )}
              {canEdit && scan && (
                <>
                  <button className={styles.btnSmall} onClick={() => setEditHead({
                    supplier: scan.supplier || '',
                    invoice_number: scan.invoice_number || '',
                    invoice_date: dateInput(scan.invoice_date),
                    document_type: scan.document_type || 'invoice',
                  })}>Edit details</button>
                  <button className={styles.btnSmallDanger} onClick={deleteDocument} disabled={busy}>
                    {busy ? '…' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {editing ? (
        <>
          {itemsError && <div className={styles.scanError}>{itemsError}</div>}
          <div className={styles.costEditTable}>
            <div className={styles.costEditHeader}>
              <span>Description</span><span>Qty</span><span>Unit ex-GST</span><span>Total ex-GST</span><span />
            </div>
            {editing.map((r, i) => (
              <div key={r.id || `new-${i}`} className={styles.costEditRow}>
                <input value={r.description} placeholder="Description"
                  onChange={e => setRow(i, 'description', e.target.value)} />
                <input type="number" step="0.01" min="0.01" value={r.quantity} aria-label="Quantity" title="Quantity"
                  onChange={e => setRow(i, 'quantity', e.target.value)} />
                {/* No min — a credit or a return is a negative line, and typing
                    the minus back in is the point of this screen. */}
                <input type="number" step="0.01" value={r.unit_price} aria-label="Unit price excluding GST" title="Unit price ex-GST"
                  onChange={e => setRow(i, 'unit_price', e.target.value)} />
                <span className={(parseFloat(r.unit_price) || 0) < 0 ? styles.costNegative : undefined}>
                  {money((parseFloat(r.unit_price) || 0) * (parseFloat(r.quantity) || 0))}
                </span>
                <button className={styles.costRowRemove} title="Remove this line"
                  onClick={() => setEditing(rows => rows.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div className={styles.costEditActions}>
            {/* A line can only be added against a document — a loose cost has no
                scan to hang it off, and those come in from the van scanner. */}
            {scan && (
              <button className={styles.btnSmall} onClick={() => setEditing(rows => [
                ...rows, { id: null, description: '', quantity: '1', unit_price: '0.00' },
              ])}>+ Add line</button>
            )}
            <span className={styles.scanHintText}>
              Enter a credit or a return as a negative unit price.
            </span>
            <button className={styles.btnSmall} onClick={() => { setEditing(null); setItemsError(''); }}>Cancel</button>
            <button className={styles.btnSmallPrimary} onClick={saveItems} disabled={savingItems}>
              {savingItems ? 'Saving…' : 'Save lines'}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.costsTable}>
          <div className={styles.costsHeader}>
            <span>Description</span><span>Qty</span><span>Ex-GST</span>
            <span>GST (15%)</span><span>Inc-GST</span><span>Total Inc-GST</span>
          </div>
          {items.map(c => {
            const ex = c.unit_price / 100;
            return (
              <div key={c.id} className={`${styles.costsRow} ${ex < 0 ? styles.costsRowCredit : ''}`}>
                <span>{c.description}</span>
                <span>{c.quantity}</span>
                <span>{money(ex)}</span>
                <span className={styles.gstCell}>{money(ex * GST_RATE)}</span>
                <span>{money(ex * (1 + GST_RATE))}</span>
                <span className={styles.costsTotalCell}>{money(ex * (1 + GST_RATE) * c.quantity)}</span>
              </div>
            );
          })}
        </div>
      )}

      {showDoc && (
        <div className={styles.costDocFrame}>
          {docError ? <div className={styles.emptySmall}>{docError}</div>
            : !docUrl ? <div className={styles.emptySmall}>Loading document…</div>
            : isPdf ? <iframe src={docUrl} title="Supplier document" className={styles.costDocIframe} />
            : <img src={docUrl} alt="Supplier document" className={styles.costDocImg} />}
        </div>
      )}
    </div>
  );
}

// ── The list of them ──────────────────────────────────────────────────────────

export default function CostDocuments({ jobId, costs, scans, canEdit, onChanged, onScanDeleted, fetchDoc }) {
  const byScan = new Map();
  for (const c of costs) {
    const key = c.scan_id || '__loose';
    if (!byScan.has(key)) byScan.set(key, []);
    byScan.get(key).push(c);
  }

  // Documents in the order the server sent them — newest invoice date first.
  // Lines with no document (stock off the van, or one since deleted) are real
  // costs on the job, so they get a group of their own at the end.
  const scanIds = new Set((scans || []).map(s => s.id));
  const loose = [...byScan.entries()]
    .filter(([k]) => k === '__loose' || !scanIds.has(k))
    .flatMap(([, v]) => v);

  const groups = [
    ...(scans || []).filter(s => byScan.has(s.id)).map(s => ({ key: s.id, scan: s, items: byScan.get(s.id) })),
    ...(loose.length ? [{ key: '__loose', scan: null, items: loose }] : []),
  ];

  return (
    <div className={styles.costDocs}>
      {groups.map(g => (
        <DocumentCard key={g.key} jobId={jobId} scan={g.scan} items={g.items} canEdit={canEdit}
          onChanged={onChanged} onScanDeleted={onScanDeleted} fetchDoc={fetchDoc} />
      ))}
    </div>
  );
}
