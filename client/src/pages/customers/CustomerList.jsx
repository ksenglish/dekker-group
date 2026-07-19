import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { canAct } from '../../lib/permissions';
import styles from './Customers.module.css';

const PAGE_SIZE = 20;

export default function CustomerList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async (q = search, p = page) => {
    setLoading(true);
    try {
      const { data } = await api.get('/customers', { params: { search: q, limit: PAGE_SIZE, page: p } });
      setCustomers(data.customers);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(search, 1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { load(search, page); }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Customers</h1>
          <p className={styles.pageSubtitle}>{total} customer{total !== 1 ? 's' : ''}</p>
        </div>
        {canAct(user?.role) && (
          <div className={styles.headerActions}>
            <button className={styles.btnSecondary} onClick={() => setShowImport(true)}>Import CSV</button>
            <button className={styles.btnPrimary} onClick={() => navigate('/customers/new')}>+ New Customer</button>
          </div>
        )}
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search by name, company, email or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : customers.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'No customers match your search.' : 'No customers yet. Add your first one.'}
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Name</span>
            <span>Address</span>
            <span>Mobile</span>
            <span>Email</span>
          </div>
          {customers.map(c => (
            <Link key={c.id} to={`/customers/${c.id}`} className={styles.tableRow}>
              <span className={styles.customerName}>{c.name}</span>
              <span className={styles.addressCell}>{[c.address_street, c.address_city].filter(Boolean).join(', ') || <span className={styles.muted}>—</span>}</span>
              <span className={styles.nowrap}>{c.mobile || c.phone || <span className={styles.muted}>—</span>}</span>
              <span>{c.email || <span className={styles.muted}>—</span>}</span>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />}
    </div>
  );
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  // Handle quoted fields properly
  function splitLine(line) {
    const result = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; }
      else if (line[i] === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += line[i]; }
    }
    result.push(cur.trim());
    return result;
  }
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, ''); });
    return obj;
  }).filter(r => r['Customer Name'] || r['name'] || r['Name']);
}

function getField(row, keys) {
  for (const k of keys) {
    if (row[k]) return row[k];
  }
  return '';
}

function ImportModal({ onClose, onImported }) {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      setCsvText(text);
      const rows = parseCsv(text);
      setRowCount(rows.length);
      setPreview(rows.slice(0, 5));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const rows = parseCsv(csvText);
    if (!rows.length) return;
    setImporting(true);
    try {
      const { data } = await api.post('/customers/import', { rows });
      setResult(data.imported);
      setTimeout(() => onImported(), 1800);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Import Customers from CSV</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.importHint}>
            Supports <strong>Tradify exports</strong> directly — just upload the file as-is.<br />
            Also accepts custom CSVs with columns: <code>name, mobile, phone, email, lead_source, address_street, address_city, address_region, address_postcode</code>
          </p>
          <input type="file" accept=".csv" onChange={handleFileChange} className={styles.fileInput} />
          {preview.length > 0 && (
            <div className={styles.importPreview}>
              <p className={styles.previewLabel}>Preview — {rowCount} customers detected:</p>
              {preview.map((r, i) => {
                const name    = getField(r, ['Customer Name', 'name', 'Name']);
                const mobile  = getField(r, ['Mobile Number', 'mobile']);
                const email   = getField(r, ['Email Address', 'email']);
                const street  = getField(r, ['Physical Address Street', 'address_street']);
                const city    = getField(r, ['Physical Address City', 'address_city']);
                const source  = getField(r, ['Lead Source', 'lead_source']);
                return (
                  <div key={i} className={styles.previewRow}>
                    <strong>{name}</strong>
                    {mobile ? <span> · {mobile}</span> : null}
                    {email  ? <span> · {email}</span>  : null}
                    {street ? <span> · {[street, city].filter(Boolean).join(', ')}</span> : null}
                    {source ? <span className={styles.previewTag}>{source}</span> : null}
                  </div>
                );
              })}
            </div>
          )}
          {result !== null && <div className={styles.importSuccess}>✓ Imported {result} customers</div>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleImport} disabled={!csvText || importing}>
            {importing ? 'Importing…' : `Import ${rowCount > 0 ? rowCount + ' customers' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
