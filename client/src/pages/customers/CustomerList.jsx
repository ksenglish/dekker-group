import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Customers.module.css';

export default function CustomerList() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async (q = search) => {
    setLoading(true);
    try {
      const { data } = await api.get('/customers', { params: { search: q, limit: 50 } });
      setCustomers(data.customers);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Customers</h1>
          <p className={styles.pageSubtitle}>{total} customer{total !== 1 ? 's' : ''}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => setShowImport(true)}>Import CSV</button>
          <button className={styles.btnPrimary} onClick={() => navigate('/customers/new')}>+ New Customer</button>
        </div>
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
            <span>Company</span>
            <span>Phone</span>
            <span>Email</span>
            <span>Sites</span>
            <span>Jobs</span>
          </div>
          {customers.map(c => (
            <Link key={c.id} to={`/customers/${c.id}`} className={styles.tableRow}>
              <span className={styles.customerName}>{c.name}</span>
              <span>{c.company || <span className={styles.muted}>—</span>}</span>
              <span>{c.phone || <span className={styles.muted}>—</span>}</span>
              <span>{c.email || <span className={styles.muted}>—</span>}</span>
              <span>{c.site_count}</span>
              <span>{c.job_count}</span>
            </Link>
          ))}
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />}
    </div>
  );
}

function ImportModal({ onClose, onImported }) {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  function parseCsv(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    }).filter(r => r.name);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      setCsvText(text);
      setPreview(parseCsv(text).slice(0, 5));
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
      setTimeout(() => onImported(), 1500);
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
          <p className={styles.importHint}>CSV must have a header row with columns: <code>name, company, phone, email</code></p>
          <input type="file" accept=".csv" onChange={handleFileChange} className={styles.fileInput} />
          {preview.length > 0 && (
            <div className={styles.importPreview}>
              <p className={styles.previewLabel}>Preview (first 5 rows):</p>
              {preview.map((r, i) => (
                <div key={i} className={styles.previewRow}>
                  <strong>{r.name}</strong>{r.company ? ` · ${r.company}` : ''}{r.email ? ` · ${r.email}` : ''}
                </div>
              ))}
            </div>
          )}
          {result !== null && <div className={styles.importSuccess}>✓ Imported {result} customers</div>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleImport} disabled={!csvText || importing}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
