import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import NewProductModal from '../../components/products/NewProductModal';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './InvoiceInbox.module.css';

const fmtDate = d => new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric',
});
const fmtCurrency = cents => `$${((cents || 0) / 100).toFixed(2)}`;

// Folders nest, so the picker shows them in tree order with the depth carried
// through — a flat alphabetical list would put a subfolder nowhere near its
// parent and make "Spark → 2026" impossible to find.
function flattenFolders(folders, parentId = null, depth = 0) {
  return folders
    .filter(f => (f.parent_id || null) === parentId)
    .flatMap(f => [{ ...f, depth }, ...flattenFolders(folders, f.id, depth + 1)]);
}

// Files a PDF under operating costs. Admins can mint a folder here rather than
// having to break off and set one up under Reports first.
const money = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 2,
});

// Things we have bought that the price list has never heard of, while they
// are still sitting here.
//
// Filing a document already adds its unknown lines automatically, under
// Supplier Purchases, named whatever the supplier called them — right for the
// hundred things nobody will ever quote, wrong for the few that matter. This
// is the chance to do those properly: a real name, the right category, and a
// decision about whether it is a material or a tool, with the cost and the
// sell price already filled in from the scan.
//
// Folded away by default. It is a prompt, not the job: the job is clearing
// the documents below it.
function NewLineItems({ refreshKey }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(null);   // the line being written up
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneKeys, setDoneKeys] = useState([]);  // dealt with this session

  const load = useCallback(() => {
    api.get('/invoice-inbox/new-lines')
      .then(r => setData(r.data))
      .catch(() => setData({ lines: [] }));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const lines = (data?.lines || []).filter(l => !doneKeys.includes(l.description));
  if (!data || lines.length === 0) return null;

  // Not everything on an invoice is something we sell. Contracting hours, a
  // skip bin, a monthly fee — they are real costs and they are never products,
  // and until now the only way past them was to add them to the price list or
  // look at them forever. Dismissing one keeps it off this list and off the
  // price list when its document is filed.
  async function dismiss(line) {
    if (!confirm(
      `Not a product: "${line.description}"?\n\n`
      + 'It stays a cost on whatever it was bought for. It just stops being offered '
      + 'here, and will not be added to the price list automatically.'
    )) return;
    setBusy(true); setError('');
    try {
      await api.post('/invoice-inbox/new-lines/dismiss', {
        description: line.description, sku: line.sku || null, supplier: line.supplier || null,
      });
      setDoneKeys(k => [...k, line.description]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not dismiss that');
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.newLines}>
      <button className={styles.newLinesHead} onClick={() => setOpen(o => !o)}>
        <span className={styles.newLinesIcon}>{open ? '📂' : '📁'}</span>
        <span className={styles.newLinesTitle}>New Line Items</span>
        <span className={styles.newLinesCount}>{lines.length}</span>
        <span className={styles.newLinesHint}>
          on the documents below, and not on the price list yet
        </span>
        <span className={styles.newLinesChevron}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className={styles.newLinesBody}>
          {error && <div className={styles.linkError}>{error}</div>}

          {lines.map(line => (
            <div key={line.description} className={styles.newLineRow}>
              <div className={styles.newLineMain}>
                <div className={styles.newLineName}>{line.description}</div>
                <div className={styles.newLineMeta}>
                  {line.supplier || 'Supplier not read'}
                  {line.sku && ` · ${line.sku}`}
                  {line.times_seen > 1 && ` · seen ${line.times_seen} times`}
                  {line.documents?.length > 0 && ` · ${line.documents.join(', ')}`}
                </div>
              </div>
              <div className={styles.newLinePrices}>
                <span>{money(line.cost_cents)} cost</span>
                <strong>{money(line.sell_cents)} sell</strong>
                <span className={styles.newLineMarkup}>+{line.markup_pct}%</span>
              </div>
              <div className={styles.newLineActions}>
                <button className={styles.btnConfirmLink} disabled={busy}
                  onClick={() => { setError(''); setAdding(line); }}>
                  Add to Price List
                </button>
                {isAdmin && (
                  <button className={styles.btnNotProduct} disabled={busy}
                    title="Not a product — stop offering this"
                    onClick={() => dismiss(line)}>
                    Not a product
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className={styles.newLinesFoot}>
            Read off {data.documents_read} document{data.documents_read === 1 ? '' : 's'} still waiting.
            Anything left here is added automatically, under Supplier Purchases, when its
            document is filed or linked to a job.
          </div>
        </div>
      )}

      {/* The same form as Add Product on the Price List — same fields, same
          layout, same stylesheet — seeded from the scan. One form to learn
          rather than a cut-down one here and the real one there. */}
      {adding && (
        <NewProductModal
          title="Add to the Price List"
          initialName={adding.description}
          initialSku={adding.sku || ''}
          initialSupplier={adding.supplier || ''}
          initialCategory='Supplier Purchases'
          initialCostDollars={(adding.cost_cents / 100).toFixed(2)}
          markupPct={adding.markup_pct ?? 30}
          onCreated={() => { setDoneKeys(k => [...k, adding.description]); setAdding(null); }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

// Where every line on one document went.
//
// Filing a receipt used to be one press, and that press turned its lines into
// a figure in the operating-cost report and nothing else. Which is how a drill
// bought at Mitre 10 ends up on the price list, in the costs, and in no van,
// no warehouse and no tool register — nobody can find it and nobody knows it
// is missing.
//
// So each line gets a destination. A location takes the same stock movement
// scanning it in would, a job takes it as a cost, and "used up" is a decision
// somebody made rather than a line nobody looked at.
function LinePlacement({ scanId, locations, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Which line is having a job picked for it, and what has been typed.
  const [jobFor, setJobFor] = useState(null);
  const [jobQuery, setJobQuery] = useState('');
  const [jobHits, setJobHits] = useState([]);
  // Tools are the exception worth asking about, so the choice sits on the row
  // rather than inside a form nobody opens.
  const [asTool, setAsTool] = useState({});

  const load = useCallback(() => {
    api.get(`/invoice-inbox/${scanId}/lines`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not read the lines on this document'));
  }, [scanId]);

  useEffect(() => { load(); }, [load]);

  async function place(body) {
    setBusy(true); setError('');
    try {
      await api.post(`/invoice-inbox/${scanId}/lines/place`, body);
      setJobFor(null); setJobQuery(''); setJobHits([]);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place that');
    } finally { setBusy(false); }
  }

  async function undo(index) {
    setBusy(true); setError('');
    try {
      await api.delete(`/invoice-inbox/${scanId}/lines/${index}/place`);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not undo that');
    } finally { setBusy(false); }
  }

  async function searchJobs(q) {
    setJobQuery(q);
    if (q.trim().length < 2) { setJobHits([]); return; }
    try {
      const { data: hits } = await api.get('/jobs', { params: { search: q.trim() } });
      const list = Array.isArray(hits) ? hits : hits.jobs || [];
      setJobHits(list.slice(0, 8));
    } catch { setJobHits([]); }
  }

  if (!data) return <div className={styles.placeLoading}>Reading the lines…</div>;

  const waiting = data.lines.filter(l => l.placeable && !l.placement);
  const warehouse = locations.find(l => l.type === 'warehouse');

  // Everything still waiting, to one place, in one press. A twelve-line
  // delivery that all went on the same van should not be twelve decisions.
  const placeRest = (destination, locationId) => place({
    placements: waiting.map(l => ({
      line_index: l.index,
      destination,
      location_id: locationId || null,
      stock_kind: asTool[l.index] ? 'tool' : 'material',
    })),
  });

  return (
    <div className={styles.placePanel}>
      <div className={styles.placeHead}>
        <strong>Where did it go?</strong>
        <span className={data.missing.length ? styles.placeLeft : styles.placeDone}>
          {data.total === 0
            ? 'Nothing on this document needs placing'
            : `${data.placed} of ${data.total} placed`}
        </span>
        {!data.scan.placement_required && data.missing.length > 0 && (
          <span className={styles.placeOptional}>
            Arrived before this step — it can still be filed without placing.
          </span>
        )}
      </div>

      {error && <div className={styles.linkError}>{error}</div>}

      {data.lines.filter(l => l.placeable).map(line => {
        const p = line.placement;
        return (
          <div key={line.index} className={styles.placeRow}>
            <div className={styles.placeWhat}>
              <div className={styles.placeName}>{line.description}</div>
              <div className={styles.placeMeta}>
                {line.quantity} × ${Number(line.unit_price).toFixed(2)}
                {line.sku ? ` · ${line.sku}` : ''}
              </div>
            </div>

            {p ? (
              <div className={styles.placeDoneRow}>
                <span className={styles.placeBadge}>
                  {p.destination === 'location' ? `→ ${p.location_name}`
                    : p.destination === 'job' ? `→ ${formatJobNumber(p) || 'job'}`
                    : '→ used up'}
                  {p.stock_kind === 'tool' ? ' · tool' : ''}
                </span>
                <button className={styles.placeUndo} disabled={busy}
                  onClick={() => undo(line.index)}>Change</button>
              </div>
            ) : jobFor === line.index ? (
              <div className={styles.placeJob}>
                <input autoFocus className={styles.searchInput} value={jobQuery}
                  placeholder="Job number or customer…"
                  onChange={e => searchJobs(e.target.value)} />
                {jobHits.map(j => (
                  <button key={j.id} className={styles.pickerItem} disabled={busy}
                    onClick={() => place({ line_index: line.index, destination: 'job', job_id: j.id })}>
                    {formatJobNumber(j)} · {j.customer_name || 'No customer'}
                  </button>
                ))}
                <button className={styles.btnCancel} onClick={() => setJobFor(null)}>Cancel</button>
              </div>
            ) : (
              <div className={styles.placeOptions}>
                <label className={styles.placeTool}
                  title="Counted apart from stock, and never charged to a job">
                  <input type="checkbox" checked={!!asTool[line.index]} disabled={busy}
                    onChange={e => setAsTool(t => ({ ...t, [line.index]: e.target.checked }))} />
                  Tool
                </label>
                {locations.filter(l => l.is_active !== false).map(l => (
                  <button key={l.id} className={styles.placeBtn} disabled={busy}
                    onClick={() => place({
                      line_index: line.index,
                      destination: 'location',
                      location_id: l.id,
                      stock_kind: asTool[line.index] ? 'tool' : 'material',
                    })}>
                    {l.type === 'warehouse' ? '🏭' : '🚚'} {l.name}
                  </button>
                ))}
                <button className={styles.placeBtn} disabled={busy}
                  onClick={() => { setJobFor(line.index); setJobQuery(''); setJobHits([]); }}>
                  🔧 A job…
                </button>
                <button className={styles.placeBtnQuiet} disabled={busy}
                  onClick={() => place({ line_index: line.index, destination: 'not_stock' })}>
                  Used up
                </button>
              </div>
            )}
          </div>
        );
      })}

      {waiting.length > 1 && (
        <div className={styles.placeAll}>
          <span>All {waiting.length} remaining to:</span>
          {warehouse && (
            <button className={styles.placeBtn} disabled={busy}
              onClick={() => placeRest('location', warehouse.id)}>🏭 {warehouse.name}</button>
          )}
          {locations.filter(l => l.type === 'van' && l.is_active !== false).map(l => (
            <button key={l.id} className={styles.placeBtn} disabled={busy}
              onClick={() => placeRest('location', l.id)}>🚚 {l.name}</button>
          ))}
          <button className={styles.placeBtnQuiet} disabled={busy}
            onClick={() => placeRest('not_stock')}>Used up</button>
        </div>
      )}

      {data.total > 0 && data.missing.length === 0 && (
        <div className={styles.placeAllDone}>
          Every line is accounted for — this can be filed or linked now.
        </div>
      )}
    </div>
  );
}

function FolderPicker({ scan, onClose, onFiled }) {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Two places a document can go, and they mean different things.
  //
  // An operating-cost folder is for a cost: it keeps the line items and shows
  // up in the costs report. A Hub folder is for a document we are keeping —
  // a price list, a manual, an insurance certificate — which arrives in the
  // same inbox and is not a cost at all. Putting one of those under operating
  // costs was the only option before, and it put it in a report it has no
  // business being in.
  const [dest, setDest] = useState('costs');   // 'costs' | 'hub'
  const [hubFolders, setHubFolders] = useState([]);

  const loadFolders = useCallback(() => {
    Promise.all([
      api.get('/costs/folders'),
      api.get('/hub/folders').catch(() => ({ data: [] })),
    ])
      .then(([costs, hub]) => { setFolders(costs.data); setHubFolders(hub.data); })
      .catch(() => setError('Could not load folders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const list = dest === 'hub' ? hubFolders : folders;

  async function fileToHub(folder) {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/invoice-inbox/${scan.id}/file-to-hub`, { folder_id: folder.id });
      onFiled({ hub: data });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not file that document');
      setBusy(false);
    }
  }

  async function createFolder(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/costs/folders', { name: newName.trim() });
      setFolders(f => [...f, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(''); setCreating(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the folder');
    } finally { setBusy(false); }
  }

  async function file(folder) {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/invoice-inbox/${scan.id}/file`, { folder_id: folder.id });
      onFiled(data?.price_list);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not file that document');
      setBusy(false);
    }
  }

  return (
    <div className={styles.pickerOverlay} onClick={onClose}>
      <div className={styles.pickerPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHeader}>
          <h2>Save to folder</h2>
          <button className={styles.pickerClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.pickerDest}>
          {[['costs', 'Operating costs'], ['hub', 'Dekker Hub']].map(([key, label]) => (
            <button key={key} type="button"
              className={`${styles.pickerDestBtn} ${dest === key ? styles.pickerDestOn : ''}`}
              onClick={() => { setDest(key); setError(''); setCreating(false); }}>
              {label}
            </button>
          ))}
        </div>

        <p className={styles.pickerHint}>
          {dest === 'hub' ? (
            <>Keeps <strong>{scan.supplier || 'this PDF'}</strong> in the Hub as a document.
              Nothing is charged to a job and nothing goes on the price list.
              It will leave PDF Check.</>
          ) : (
            <>Files <strong>{scan.supplier || 'this PDF'}</strong> under operating costs,
              with its line items. It will leave PDF Check.</>
          )}
        </p>

        {error && <div className={styles.linkError}>{error}</div>}

        {loading ? (
          <div className={styles.pickerEmpty}>Loading…</div>
        ) : list.length === 0 && !creating ? (
          <div className={styles.pickerEmpty}>
            No folders yet.{' '}
            {dest === 'hub'
              ? 'An admin can add one on the Dekker Hub.'
              : user?.role === 'admin'
              ? 'Create one below.'
              : 'An admin needs to create one under Reports → Costs first.'}
          </div>
        ) : (
          <div className={styles.pickerList}>
            {flattenFolders(list).map(f => (
              <button
                key={f.id}
                className={styles.pickerItem}
                onClick={() => (dest === 'hub' ? fileToHub(f) : file(f))}
                disabled={busy}
                style={{ paddingLeft: 12 + f.depth * 16 }}
              >
                <span>📁 {f.name}</span>
                <span className={styles.pickerCount}>{f.document_count}</span>
              </button>
            ))}
          </div>
        )}

        {dest === 'costs' && user?.role === 'admin' && (
          creating ? (
            <form className={styles.pickerNew} onSubmit={createFolder}>
              <input
                className={styles.searchInput}
                placeholder="Supplier name, e.g. Spark"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
              />
              <button type="submit" className={styles.btnConfirmLink} disabled={busy || !newName.trim()}>Add</button>
              <button type="button" className={styles.btnCancel} onClick={() => setCreating(false)}>Cancel</button>
            </form>
          ) : (
            <button className={styles.pickerNewBtn} onClick={() => setCreating(true)}>+ New folder</button>
          )
        )}
      </div>
    </div>
  );
}

export default function InvoiceInboxPage() {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(null); // scan id being linked
  const [jobSearch, setJobSearch] = useState('');
  const [jobResults, setJobResults] = useState([]);
  const [jobSearching, setJobSearching] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [pdfPreview, setPdfPreview] = useState(null); // scan being previewed
  // The list no longer carries the documents themselves — it used to send every
  // waiting PDF down just to render a list of suppliers. One is fetched when
  // it's actually asked for, and the object URL is released on the way out.
  const [pdfUrl, setPdfUrl] = useState(null);
  // Corrections to what the reader pulled off a PDF, keyed by scan id. Only
  // holds the invoice currently being edited — saving writes it back to the
  // scan and clears it.
  const [editing, setEditing] = useState(null);   // { scanId, items: [...] }
  const [savingItems, setSavingItems] = useState(false);
  const [itemsError, setItemsError] = useState('');

  function startEditing(scan) {
    const items = Array.isArray(scan.parsed_items) ? scan.parsed_items : [];
    setItemsError('');
    setEditing({
      scanId: scan.id,
      items: items.map(i => ({
        description: i.description || '',
        quantity: String(i.quantity ?? 1),
        unit_price: String(i.unit_price ?? 0),
      })),
    });
  }

  function updateItem(idx, field, value) {
    setEditing(e => ({ ...e, items: e.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));
    setItemsError('');
  }
  function addItem() {
    setEditing(e => ({ ...e, items: [...e.items, { description: '', quantity: '1', unit_price: '0' }] }));
  }
  function removeItem(idx) {
    setEditing(e => ({ ...e, items: e.items.filter((_, i) => i !== idx) }));
  }

  async function saveItems() {
    const payload = editing.items.map(i => ({
      description: i.description.trim(),
      quantity: parseFloat(i.quantity),
      unit_price: parseFloat(i.unit_price),
    }));
    if (payload.some(i => !i.description)) { setItemsError('Every line needs a description'); return; }
    if (payload.some(i => !Number.isFinite(i.unit_price))) { setItemsError('Every line needs a unit price'); return; }
    setSavingItems(true); setItemsError('');
    try {
      const { data } = await api.put(`/invoice-inbox/${editing.scanId}/items`, { items: payload });
      setScans(s => s.map(x => x.id === editing.scanId ? { ...x, parsed_items: data.parsed_items } : x));
      setEditing(null);
    } catch (err) {
      setItemsError(err.response?.data?.error || 'Could not save these line items');
    } finally { setSavingItems(false); }
  }

  async function togglePdf(scanId) {
    if (pdfPreview === scanId) {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
      setPdfPreview(null);
      return;
    }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setPdfPreview(scanId);
    try {
      const res = await api.get(`/costs/documents/${scanId}`, { responseType: 'blob' });
      setPdfUrl(URL.createObjectURL(res.data));
    } catch {
      setPdfPreview(null);
      alert('Could not open that document');
    }
  }

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  const [filing, setFiling] = useState(null);         // scan being filed to a folder
  // The page's own, not the folder picker's — that one has a `busy` of its own
  // and reaching for it from here is how the tab stops rendering.
  const [filingBusy, setFilingBusy] = useState(false);
  // What reached the price list, said out loud. Filing a document now adds
  // anything on it we have never bought before, and a write nobody sees is a
  // write nobody trusts.
  // Reading a receipt in from here rather than waiting for it to be emailed.
  const uploadRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // Bumped whenever the waiting documents change, so the New Line Items panel
  // re-reads: what is new depends entirely on what is still in the inbox.
  const [newLinesKey, setNewLinesKey] = useState(0);
  // Which document is showing its lines, and the places they can go.
  const [placing, setPlacing] = useState(null);
  const [stockLocations, setStockLocations] = useState([]);
  const [added, setAdded] = useState(null);
  // The warehouse and the vans, which are where most lines end up.
  useEffect(() => {
    api.get('/stock/locations').then(r => setStockLocations(r.data)).catch(() => {});
  }, []);
  const [selected, setSelected] = useState([]);       // ids ticked for bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/invoice-inbox')
      .then(r => { setScans(r.data); setSelected([]); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // What is new depends entirely on what is still waiting, so anything that
    // changes the list changes that too — filing a document takes its lines
    // off this panel.
    setNewLinesKey(k => k + 1);
  }, []);

  const allSelected = scans.length > 0 && selected.length === scans.length;

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  function toggleSelectAll() {
    setSelected(allSelected ? [] : scans.map(s => s.id));
  }

  async function handleBulkDelete() {
    const n = selected.length;
    if (!confirm(`Delete ${n} invoice${n === 1 ? '' : 's'} from the inbox? They will not be added to any job.`)) return;
    setBulkDeleting(true);
    try {
      await api.post('/invoice-inbox/bulk-delete', { ids: selected });
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch { alert('Bulk delete failed'); }
    finally { setBulkDeleting(false); }
  }

  useEffect(() => { load(); }, [load]);

  async function searchJobs(q) {
    if (!q.trim()) { setJobResults([]); return; }
    setJobSearching(true);
    try {
      const r = await api.get(`/jobs?search=${encodeURIComponent(q)}&limit=10`);
      setJobResults(r.data.jobs || r.data || []);
    } catch { setJobResults([]); }
    finally { setJobSearching(false); }
  }

  // Only worth saying when something actually happened; most documents are
  // repeat buys and add nothing.
  function noteAdded(result) {
    // Filing to the Hub answers with the document it made rather than with
    // price-list rows, because it deliberately makes none.
    if (result?.hub) {
      setAdded({ hub: result.hub.folder?.name || 'the Hub' });
      return;
    }
    const made = result?.created || [];
    if (!made.length) return;
    setAdded({ created: made.length, tools: made.every(m => m.stock_kind === 'tool') });
  }

  async function handleLink(scanId) {
    if (!selectedJob) { setLinkError('Please select a job first'); return; }
    setLinkError('');
    try {
      const { data } = await api.post(`/invoice-inbox/${scanId}/link`, { job_id: selectedJob.id });
      noteAdded(data?.price_list);
      setLinking(null);
      setSelectedJob(null);
      setJobSearch('');
      setJobResults([]);
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch (err) {
      setLinkError(err.response?.data?.error || 'Failed to link');
    }
  }

  // Taking the app's suggestion. The same route the folder picker uses, so a
  // document filed this way is filed exactly as one filed by hand.
  async function fileTo(scan, folderId) {
    setFilingBusy(true);
    try {
      const { data } = await api.post(`/invoice-inbox/${scan.id}/file`, { folder_id: folderId });
      noteAdded(data?.price_list);
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch (err) {
      // The whole point of the step: it will not file until every line has
      // somewhere to be. The panel is opened on the spot rather than leaving
      // somebody to find the button that answers the complaint.
      if (err.response?.data?.needs_placement) {
        setPlacing(scan.id);
        alert(err.response.data.error);
      } else {
        alert(err.response?.data?.error || 'Could not file that document');
      }
    } finally { setFilingBusy(false); }
  }

  // Everything waiting that the app is sure about, put away in one go. The
  // rest keep their suggestion and stay here.
  async function fileEverythingObvious() {
    if (!confirm(
      'File every document the app is sure about?\n\n'
      + 'Only the ones where the folders and your own past filing agree are moved. '
      + 'Anything less certain stays here with its folder suggested, and so does '
    + 'anything whose lines have not been placed yet.'
    )) return;
    setFilingBusy(true);
    try {
      const { data } = await api.post('/invoice-inbox/file-waiting', {});
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
      alert(
        `${data.filed} filed, ${data.suggested} left with a suggestion, `
        + (data.needs_placement
          ? `${data.needs_placement} waiting on where its lines went, `
          : '')
        + `${data.stumped} with nothing to go on.`
      );
    } catch {
      alert('Could not file those');
    } finally { setFilingBusy(false); }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setUploadError('That file is over 10MB — try a photo rather than a scan.'); return; }
    setUploading(true); setUploadError('');
    try {
      const data_base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { data } = await api.post('/invoice-inbox/upload', {
        filename: file.name, mime_type: file.type, data_base64,
      });
      load();
      setNewLinesKey(k => k + 1);
      window.dispatchEvent(new Event('invoice-inbox-updated'));
      if (!data.items_found) {
        setUploadError(
          'That document is in the list, but no line items could be read off it — '
          + 'use Edit Lines to enter them by hand.'
        );
      }
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Could not read that document.');
    } finally { setUploading(false); }
  }

  async function handleDelete(scanId) {
    if (!confirm('Remove this invoice from the inbox? It will not be added to any job.')) return;
    try {
      await api.delete(`/invoice-inbox/${scanId}`);
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch { alert('Delete failed'); }
  }

  function openLink(scan) {
    setLinking(scan.id);
    setSelectedJob(null);
    setJobSearch('');
    setJobResults([]);
    setLinkError('');
  }

  if (loading) return <div className={styles.loading}>Loading invoice inbox…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>PDF Check</h1>
          <p className={styles.subtitle}>
            Scanned supplier PDFs that couldn't be matched to a job automatically.
            Link each one to the right job, file it under operating costs, or
            delete it if it isn't a cost at all.
          </p>
        </div>
        {/* A receipt handed over on site had to be emailed to office@ and
            waited for. This reads it here and puts it at the top of the same
            list, so it links to a job by the route that already exists. */}
        <div className={styles.headerActions}>
          <input ref={uploadRef} type="file" accept="image/*,application/pdf,.pdf"
            style={{ display: 'none' }} onChange={handleUpload} />
          <button className={styles.btnUpload} disabled={uploading}
            onClick={() => uploadRef.current?.click()}>
            {uploading
              ? <><span className={styles.uploadSpinner} /> Reading…</>
              : <>✨ Upload Receipt / Invoice</>}
          </button>
          <span className={styles.uploadHint}>Photo or PDF · max 10MB</span>
        </div>
      </div>

      {uploadError && <div className={styles.linkError}>{uploadError}</div>}

      <NewLineItems refreshKey={newLinesKey} />

      {filing && (
        <FolderPicker
          scan={filing}
          onClose={() => setFiling(null)}
          onFiled={result => {
            noteAdded(result);
            setFiling(null);
            load();
            window.dispatchEvent(new Event('invoice-inbox-updated'));
          }}
        />
      )}


      {scans.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.selectAll}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            {allSelected ? 'Deselect all' : `Select all (${scans.length})`}
          </label>
          {selected.length === 0 && (
            <button className={styles.btnFile} onClick={fileEverythingObvious} disabled={filingBusy}>
              📁 File everything obvious
            </button>
          )}
          {selected.length > 0 && (
            <div className={styles.toolbarActions}>
              <span className={styles.selectedCount}>{selected.length} selected</span>
              <button
                className={styles.btnBulkDelete}
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selected.length}`}
              </button>
            </div>
          )}
        </div>
      )}

      {added && (
        <div className={styles.priceListNote}>
          {added.hub
            ? `Saved to the Hub, under ${added.hub}.`
            : `${added.created} new product${added.created === 1 ? '' : 's'} added to the Price List`
              + ` under Supplier Purchases${added.tools ? ', as tools' : ''}.`}
          <button className={styles.priceListNoteClose} onClick={() => setAdded(null)}>✕</button>
        </div>
      )}

      {scans.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✓</div>
          <div className={styles.emptyText}>All clear — no unmatched invoices</div>
        </div>
      )}

      <div className={styles.list}>
        {scans.map(scan => {
          const items = Array.isArray(scan.parsed_items) ? scan.parsed_items : [];
          const total = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 1), 0);
          const isEditing = editing?.scanId === scan.id;
          const editingTotal = isEditing
            ? editing.items.reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (parseFloat(i.quantity) || 0), 0)
            : 0;

          return (
            <div key={scan.id} className={`${styles.card} ${selected.includes(scan.id) ? styles.cardSelected : ''}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardMeta}>
                  <input
                    type="checkbox"
                    className={styles.cardCheckbox}
                    checked={selected.includes(scan.id)}
                    onChange={() => toggleSelect(scan.id)}
                    aria-label="Select invoice"
                  />
                  <span className={styles.supplier}>{scan.supplier || 'Unknown supplier'}</span>
                  {/* A statement is not an invoice and does not belong on a
                      job — worth saying on the row, since the two look alike
                      at a glance and only one of them is a cost. */}
                  {scan.document_type && scan.document_type !== 'invoice' && (
                    <span className={styles.docType}>
                      {scan.document_type.replace(/_/g, ' ')}
                    </span>
                  )}
                  {scan.invoice_number && (
                    <span className={styles.invNum}>#{scan.invoice_number}</span>
                  )}
                  <span className={styles.date}>{fmtDate(scan.created_at)}</span>
                </div>
                <div className={styles.cardActions}>
                  {scan.has_document && (
                    <button className={styles.btnPreview} onClick={() => togglePdf(scan.id)}>
                      {pdfPreview === scan.id ? 'Hide PDF' : 'View PDF'}
                    </button>
                  )}
                  {!isEditing && (
                    <button className={styles.btnEditLines} onClick={() => startEditing(scan)}>
                      Edit Lines
                    </button>
                  )}
                  <button className={styles.btnLink} onClick={() => openLink(scan)}>
                    Link to Job
                  </button>
                  {/* The step that keeps a drill from going missing: every
                      line has to end up somewhere before the document can be
                      filed away as an operating cost. */}
                  <button
                    className={`${styles.btnPlace} ${placing === scan.id ? styles.btnPlaceOpen : ''}`}
                    onClick={() => setPlacing(placing === scan.id ? null : scan.id)}>
                    {placing === scan.id ? 'Hide lines' : 'Where did it go?'}
                  </button>
                  <button className={styles.btnFile} onClick={() => setFiling(scan)}>
                    Save to Folder
                  </button>
                  <button className={styles.btnDelete} onClick={() => handleDelete(scan.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {scan.detected_job_number && (
                <div className={styles.detectedJob}>
                  Detected job number: <strong>{scan.detected_job_number}</strong> — not found in app
                </div>
              )}

              {/* The app had a view but was not sure enough to act on it. The
                  folder is already chosen; filing is one press. */}
              {scan.suggested_folder_id && (
                <div className={styles.suggestion}>
                  <span>
                    Probably <strong>{scan.suggested_folder_name}</strong>
                    {scan.filed_because && <em className={styles.because}> — {scan.filed_because}</em>}
                  </span>
                  <button className={styles.btnFile} disabled={filingBusy}
                    onClick={() => fileTo(scan, scan.suggested_folder_id)}>
                    File it there
                  </button>
                </div>
              )}

              {isEditing ? (
                <>
                  {itemsError && <div className={styles.itemsError}>{itemsError}</div>}
                  <table className={styles.itemsTable}>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className={styles.num}>Qty</th>
                        <th className={styles.num}>Unit Price</th>
                        <th className={styles.num}>Total</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {editing.items.map((item, i) => {
                        const lineTotal = (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 0);
                        return (
                          <tr key={i}>
                            <td>
                              <input className={styles.editInput} value={item.description}
                                placeholder="Description"
                                onChange={e => updateItem(i, 'description', e.target.value)} />
                            </td>
                            <td className={styles.num}>
                              <input className={styles.editNum} type="number" step="0.01" value={item.quantity}
                                onChange={e => updateItem(i, 'quantity', e.target.value)} />
                            </td>
                            <td className={styles.num}>
                              {/* No min — a credit line is negative and must stay that way */}
                              <input className={styles.editNum} type="number" step="0.01" value={item.unit_price}
                                onChange={e => updateItem(i, 'unit_price', e.target.value)} />
                            </td>
                            <td className={styles.num}>${lineTotal.toFixed(2)}</td>
                            <td className={styles.num}>
                              <button className={styles.rowRemove} onClick={() => removeItem(i)} title="Remove line">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className={styles.totalRow}>
                        <td colSpan={3}>Total (ex GST)</td>
                        <td className={styles.num}>${editingTotal.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                  <div className={styles.editActions}>
                    <button className={styles.btnAddLine} onClick={addItem}>+ Add line</button>
                    <span style={{ flex: 1 }} />
                    <button className={styles.btnCancelEdit} onClick={() => { setEditing(null); setItemsError(''); }}>Cancel</button>
                    <button className={styles.btnSaveItems} onClick={saveItems} disabled={savingItems}>
                      {savingItems ? 'Saving…' : 'Save Line Items'}
                    </button>
                  </div>
                </>
              ) : items.length > 0 ? (
                <table className={styles.itemsTable}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className={styles.num}>Qty</th>
                      <th className={styles.num}>Unit Price</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.description}</td>
                        <td className={styles.num}>{item.quantity ?? 1}</td>
                        <td className={styles.num}>${(item.unit_price || 0).toFixed(2)}</td>
                        <td className={styles.num}>${((item.unit_price || 0) * (item.quantity || 1)).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalRow}>
                      <td colSpan={3}>Total (ex GST)</td>
                      <td className={styles.num}>${total.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div className={styles.noItems}>
                  No line items could be extracted from this invoice — use Edit Lines to enter them by hand
                </div>
              )}

              {placing === scan.id && (
                <LinePlacement
                  scanId={scan.id}
                  locations={stockLocations}
                  onChanged={() => { load(); window.dispatchEvent(new Event('invoice-inbox-updated')); }}
                />
              )}

              {pdfPreview === scan.id && (
                <div className={styles.pdfFrame}>
                  <iframe
                    src={pdfUrl || undefined}
                    title="Invoice PDF"
                    className={styles.iframe}
                  />
                </div>
              )}

              {linking === scan.id && (
                <div className={styles.linkPanel}>
                  <div className={styles.linkTitle}>Link to Job</div>
                  <div className={styles.searchRow}>
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="Search by job number or customer name…"
                      value={jobSearch}
                      onChange={e => {
                        setJobSearch(e.target.value);
                        searchJobs(e.target.value);
                      }}
                      autoFocus
                    />
                    {jobSearching && <span className={styles.searching}>Searching…</span>}
                  </div>

                  {jobResults.length > 0 && !selectedJob && (
                    <div className={styles.jobResults}>
                      {jobResults.map(job => (
                        <button
                          key={job.id}
                          className={styles.jobResult}
                          onClick={() => { setSelectedJob(job); setJobResults([]); }}
                        >
                          <strong>JB{String(job.job_number).padStart(5, '0')}</strong>
                          {' — '}
                          {job.title}
                          {job.customer_name && <span className={styles.custName}> ({job.customer_name})</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedJob && (
                    <div className={styles.selectedJob}>
                      Selected: <strong>JB{String(selectedJob.job_number).padStart(5, '0')} — {selectedJob.title}</strong>
                      <button className={styles.clearJob} onClick={() => setSelectedJob(null)}>✕</button>
                    </div>
                  )}

                  {linkError && <div className={styles.linkError}>{linkError}</div>}

                  <div className={styles.linkButtons}>
                    <button
                      className={styles.btnConfirmLink}
                      onClick={() => handleLink(scan.id)}
                      disabled={!selectedJob}
                    >
                      Confirm Link
                    </button>
                    <button
                      className={styles.btnCancel}
                      onClick={() => setLinking(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
