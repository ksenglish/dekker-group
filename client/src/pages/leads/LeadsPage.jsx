import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Leads.module.css';

const STATUSES = ['new', 'contacted', 'converted', 'dismissed'];
const STATUS_COLOURS = { new: '#1e40af', contacted: '#d97706', converted: '#16a34a', dismissed: '#6b7280' };
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', converted: 'Converted', dismissed: 'Dismissed' };

export default function LeadsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('new');
  const [selected, setSelected] = useState(null);
  const [converting, setConverting] = useState(false);

  function load() {
    api.get('/leads').then(r => setLeads(r.data)).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }), {});
  const visible = filter ? leads.filter(l => l.status === filter) : leads;

  async function setStatus(lead, status) {
    const { data } = await api.patch(`/leads/${lead.id}/status`, { status });
    setLeads(ls => ls.map(l => l.id === lead.id ? data : l));
    setSelected(s => s && s.id === lead.id ? data : s);
  }

  async function convert(lead) {
    if (!confirm(`Create a customer from ${lead.name}?`)) return;
    setConverting(true);
    try {
      const { data } = await api.post(`/leads/${lead.id}/convert`);
      navigate(`/customers/${data.customer_id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to convert lead');
    } finally { setConverting(false); }
  }

  async function remove(lead) {
    if (!confirm(`Delete the lead from ${lead.name}? This cannot be undone.`)) return;
    await api.delete(`/leads/${lead.id}`);
    setLeads(ls => ls.filter(l => l.id !== lead.id));
    setSelected(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New Leads</h1>
          <p className={styles.pageSubtitle}>Enquiries from your website contact forms</p>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        {STATUSES.map(s => (
          <button key={s} className={`${styles.summaryCard} ${filter === s ? styles.summaryCardActive : ''}`}
            onClick={() => setFilter(f => f === s ? '' : s)}>
            <span className={styles.summaryCount} style={{ color: STATUS_COLOURS[s] }}>{counts[s] || 0}</span>
            <span className={styles.summaryLabel}>{STATUS_LABEL[s]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          {filter ? `No ${STATUS_LABEL[filter].toLowerCase()} leads.` : 'No leads yet.'} New website enquiries will appear here automatically.
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Received</span>
            <span>Name</span>
            <span>Contact</span>
            <span>Service</span>
            <span>Source</span>
            <span>Status</span>
          </div>
          {visible.map(lead => (
            <button key={lead.id} className={styles.tableRow} onClick={() => setSelected(lead)}>
              <span className={styles.muted}>{new Date(lead.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</span>
              <span className={styles.leadName}>{lead.name}</span>
              <span className={styles.contactCell}>
                {lead.phone && <span>{lead.phone}</span>}
                {lead.email && <span className={styles.muted}>{lead.email}</span>}
              </span>
              <span>{lead.service_required || <span className={styles.muted}>—</span>}</span>
              <span className={styles.muted}>{lead.source || '—'}</span>
              <span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[lead.status] + '18', color: STATUS_COLOURS[lead.status] }}>
                  {STATUS_LABEL[lead.status]}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{selected.name}</h2>
              <button className={styles.modalClose} onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className={styles.pipeline}>
              {STATUSES.map(s => (
                <button key={s}
                  className={`${styles.pipelineBtn} ${selected.status === s ? styles.pipelineBtnActive : ''}`}
                  style={selected.status === s ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s], background: STATUS_COLOURS[s] + '12' } : {}}
                  onClick={() => setStatus(selected, s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            <div className={styles.detailList}>
              {selected.phone && <div className={styles.detailRow}><span>Phone</span><strong><a href={`tel:${selected.phone}`}>{selected.phone}</a></strong></div>}
              {selected.email && <div className={styles.detailRow}><span>Email</span><strong><a href={`mailto:${selected.email}`}>{selected.email}</a></strong></div>}
              {selected.service_required && <div className={styles.detailRow}><span>Service Required</span><strong>{selected.service_required}</strong></div>}
              {selected.source && <div className={styles.detailRow}><span>Source</span><strong>{selected.source}</strong></div>}
              <div className={styles.detailRow}><span>Received</span><strong>{new Date(selected.created_at).toLocaleString('en-NZ')}</strong></div>
              {selected.customer_name && <div className={styles.detailRow}><span>Customer</span><strong>{selected.customer_name}</strong></div>}
            </div>

            {selected.message && <div className={styles.messageBlock}>{selected.message}</div>}

            <div className={styles.modalFooter}>
              {user?.role === 'admin' && (
                <button className={styles.btnDanger} onClick={() => remove(selected)}>Delete</button>
              )}
              {!selected.customer_id ? (
                <button className={styles.btnPrimary} onClick={() => convert(selected)} disabled={converting}>
                  {converting ? 'Converting…' : '→ Convert to Customer'}
                </button>
              ) : (
                <button className={styles.btnSecondary} onClick={() => navigate(`/customers/${selected.customer_id}`)}>
                  View Customer
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
