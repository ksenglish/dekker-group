import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { toLocalDateStr } from '../../lib/date';
import { isAdmin } from '../../lib/permissions';
import styles from './Jobs.module.css';
import formStyles from './ElectricalCocForm.module.css';

function buildContactDetails(job) {
  if (!job) return '';
  const address = [
    job.customer_address_street, job.customer_address_city,
    job.customer_address_region, job.customer_address_postcode, job.customer_address_country,
  ].filter(Boolean).join(', ');
  return [job.customer_name, address].filter(Boolean).join('\n');
}

function buildPhoneEmail(user) {
  if (!user) return '';
  return [user.mobile, user.email].filter(Boolean).join(' / ');
}

function emptyDraft(job, user) {
  const today = toLocalDateStr();
  return {
    reference_no: '',
    location_details: job?.site_address || '',
    contact_details: buildContactDetails(job),
    electrical_worker_name: user?.name || '',
    licence_number: user?.licence_number || '',
    phone_email: buildPhoneEmail(user),
    supervised_persons: '',
    work_type: '', risk_level: '', high_risk_detail: '',
    compliance_part: '',
    additional_standards_required: null, additional_standards_detail: '',
    work_date_range: '',
    fittings_safe: null,
    supply_system_type: '',
    earthing_correctly_rated: null,
    parts_scope: '', parts_scope_detail: '',
    relies_on_manual: null, manual_identify: '', manual_link: '',
    relies_on_certified_design: null, design_identify: '', design_link: '',
    relies_on_sdoc: null, sdoc_identify: '', sdoc_link: '',
    satisfactorily_tested: null,
    description_of_work: '',
    test_polarity: '', test_insulation_resistance: '', test_earth_continuity: '',
    test_bonding: '', test_fault_loop_impedance: '', test_other: '',
    coc_certifier_signature: user?.name || '',
    coc_signed_date: today,
    esc_certifier_name: user?.name || '',
    esc_licence_number: user?.licence_number || '',
    esc_certifier_signature: user?.name || '',
    esc_issue_date: today,
    esc_connection_date: '',
  };
}

// Normalise DATE columns (returned as full timestamps) down to yyyy-mm-dd for <input type="date">
function normaliseForDraft(row) {
  return {
    ...row,
    coc_signed_date: row.coc_signed_date ? String(row.coc_signed_date).slice(0, 10) : '',
    esc_issue_date: row.esc_issue_date ? String(row.esc_issue_date).slice(0, 10) : '',
    esc_connection_date: row.esc_connection_date ? String(row.esc_connection_date).slice(0, 10) : '',
  };
}

function CheckGroup({ options, value, onChange }) {
  return (
    <div className={formStyles.checkRow}>
      {options.map(([key, label]) => (
        <label key={key} className={styles.techCheckItem} style={{ padding: 0 }}>
          <input type="checkbox" checked={value === key} onChange={() => onChange(value === key ? '' : key)} />
          {label}
        </label>
      ))}
    </div>
  );
}

function YesNo({ value, onChange }) {
  return (
    <div className={formStyles.checkRow}>
      <label className={styles.techCheckItem} style={{ padding: 0 }}>
        <input type="checkbox" checked={value === true} onChange={() => onChange(value === true ? null : true)} />
        Yes
      </label>
      <label className={styles.techCheckItem} style={{ padding: 0 }}>
        <input type="checkbox" checked={value === false} onChange={() => onChange(value === false ? null : false)} />
        No
      </label>
    </div>
  );
}

function yesNoText(v) { return v === true ? '✅ Yes' : v === false ? '❌ No' : '—'; }

export default function ElectricalCocForm({ jobId, job, user, onBack, onSaved }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(job, user));
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get(`/jobs/${jobId}/electrical-coc`).then(r => {
      setForm(r.data);
      if (!r.data) {
        setDraft(emptyDraft(job, user));
        setEditing(true);
      } else {
        setDraft(normaliseForDraft(r.data));
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function set(k, v) { setDraft(d => ({ ...d, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put(`/jobs/${jobId}/electrical-coc`, draft);
      setForm(data);
      setDraft(normaliseForDraft(data));
      setEditing(false);
      onSaved?.(data);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      const res = await api.get(`/jobs/${jobId}/electrical-coc/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `electrical-coc-${jobId.slice(0, 8)}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this Electrical COC? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.delete(`/jobs/${jobId}/electrical-coc`);
      onSaved?.(null);
      onBack();
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className={styles.card}><div className={styles.emptySmall}>Loading…</div></div>;

  // Anyone onsite can complete the form the first time; once it exists, only
  // Admin or the person who originally completed it can edit it, and only
  // Admin can delete it.
  const admin = isAdmin(user?.role);
  const canEdit = !form || admin || form.completed_by === user?.id;
  const canDelete = admin && !!form;

  const header = (
    <div className={formStyles.formHeader}>
      <button type="button" className={formStyles.backLink} onClick={onBack}>← Back to Forms</button>
      <h3 className={formStyles.title}>Electrical COC</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        {form && !editing && (
          <button type="button" className={styles.btnSecondary} onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? 'Preparing…' : '⬇ Download PDF'}
          </button>
        )}
        {form && !editing && canEdit && (
          <button type="button" className={styles.btnSecondary} onClick={() => setEditing(true)}>Edit</button>
        )}
        {form && !editing && canDelete && (
          <button type="button" className={styles.btnDanger} onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );

  if (!editing && form) {
    return (
      <div className={styles.card}>
        {header}
        <div className={formStyles.section}>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}><span>Reference / Certificate ID No.</span><strong>{form.reference_no || '—'}</strong></div>
            <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Location Details</span><strong style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{form.location_details || '—'}</strong></div>
            <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Contact Details</span><strong style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{form.contact_details || '—'}</strong></div>
            <div className={styles.detailItem}><span>Electrical Worker</span><strong>{form.electrical_worker_name || '—'}</strong></div>
            <div className={styles.detailItem}><span>Licence Number</span><strong>{form.licence_number || '—'}</strong></div>
            <div className={styles.detailItem}><span>Phone & Email</span><strong>{form.phone_email || '—'}</strong></div>
            <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Person(s) Supervised</span><strong style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{form.supervised_persons || '—'}</strong></div>
            <div className={styles.detailItem}><span>Completed By</span><strong>{form.completed_by_name || '—'}</strong></div>
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Certificate of Compliance</h4>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}><span>Type of Work</span><strong style={{ textTransform: 'capitalize' }}>{form.work_type?.replace('_', ' ') || '—'}</strong></div>
            <div className={styles.detailItem}><span>Risk Level</span><strong style={{ textTransform: 'capitalize' }}>{form.risk_level?.replace('_', ' ') || '—'}{form.risk_level === 'high_risk' && form.high_risk_detail ? ` (${form.high_risk_detail})` : ''}</strong></div>
            <div className={styles.detailItem}><span>Means of Compliance</span><strong>{form.compliance_part === 'part1' ? 'Part 1 of AS/NZS 3000' : form.compliance_part === 'part2' ? 'Part 2 of AS/NZS 3000' : '—'}</strong></div>
            <div className={styles.detailItem}><span>Additional Standards Required</span><strong>{yesNoText(form.additional_standards_required)}{form.additional_standards_detail ? ` (${form.additional_standards_detail})` : ''}</strong></div>
            <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Date(s) of Work</span><strong>{form.work_date_range || '—'}</strong></div>
            <div className={styles.detailItem}><span>Fittings Safe to Connect</span><strong>{yesNoText(form.fittings_safe)}</strong></div>
            <div className={styles.detailItem}><span>Supply System Type</span><strong>{form.supply_system_type || '—'}</strong></div>
            <div className={styles.detailItem}><span>Earthing Correctly Rated</span><strong>{yesNoText(form.earthing_correctly_rated)}</strong></div>
            <div className={styles.detailItem}><span>Parts Covered</span><strong>{form.parts_scope === 'all' ? 'All' : form.parts_scope === 'parts' ? (form.parts_scope_detail || 'Parts (unspecified)') : '—'}</strong></div>
            <div className={styles.detailItem}><span>Relies on Manufacturer's Instructions</span><strong>{yesNoText(form.relies_on_manual)}{form.relies_on_manual ? ` — ${form.manual_identify || '—'}` : ''}</strong></div>
            <div className={styles.detailItem}><span>Relies on Certified Design</span><strong>{yesNoText(form.relies_on_certified_design)}{form.relies_on_certified_design ? ` — ${form.design_identify || '—'}` : ''}</strong></div>
            <div className={styles.detailItem}><span>Relies on SDoC</span><strong>{yesNoText(form.relies_on_sdoc)}{form.relies_on_sdoc ? ` — ${form.sdoc_identify || '—'}` : ''}</strong></div>
            <div className={styles.detailItem}><span>Satisfactorily Tested</span><strong>{yesNoText(form.satisfactorily_tested)}</strong></div>
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Description of Work & Test Results</h4>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Description of Work</span><strong style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{form.description_of_work || '—'}</strong></div>
            <div className={styles.detailItem}><span>Polarity (Independent Earth)</span><strong>{form.test_polarity || '—'}</strong></div>
            <div className={styles.detailItem}><span>Insulation Resistance</span><strong>{form.test_insulation_resistance || '—'}</strong></div>
            <div className={styles.detailItem}><span>Earth Continuity</span><strong>{form.test_earth_continuity || '—'}</strong></div>
            <div className={styles.detailItem}><span>Bonding</span><strong>{form.test_bonding || '—'}</strong></div>
            <div className={styles.detailItem}><span>Fault Loop Impedance</span><strong>{form.test_fault_loop_impedance || '—'}</strong></div>
            <div className={styles.detailItem}><span>Other</span><strong>{form.test_other || '—'}</strong></div>
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Sign-Off</h4>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}><span>COC Certifier's Signature</span><strong>{form.coc_certifier_signature || '—'}</strong></div>
            <div className={styles.detailItem}><span>COC Date</span><strong>{form.coc_signed_date ? new Date(form.coc_signed_date).toLocaleDateString('en-NZ') : '—'}</strong></div>
            <div className={styles.detailItem}><span>ESC Certifier's Name</span><strong>{form.esc_certifier_name || '—'}</strong></div>
            <div className={styles.detailItem}><span>ESC Licence Number</span><strong>{form.esc_licence_number || '—'}</strong></div>
            <div className={styles.detailItem}><span>ESC Certifier's Signature</span><strong>{form.esc_certifier_signature || '—'}</strong></div>
            <div className={styles.detailItem}><span>ESC Issue Date</span><strong>{form.esc_issue_date ? new Date(form.esc_issue_date).toLocaleDateString('en-NZ') : '—'}</strong></div>
            <div className={styles.detailItem}><span>Connection Date</span><strong>{form.esc_connection_date ? new Date(form.esc_connection_date).toLocaleDateString('en-NZ') : '—'}</strong></div>
            <div className={styles.detailItem}><span>Last Saved</span><strong>{new Date(form.updated_at).toLocaleString('en-NZ')}</strong></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {header}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className={formStyles.section}>
          <div className={styles.field}>
            <label>Reference / Certificate ID No.</label>
            <input value={draft.reference_no} onChange={e => set('reference_no', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Location Details</label>
            <textarea rows={2} value={draft.location_details} onChange={e => set('location_details', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Contact Details (Name and address)</label>
            <textarea rows={2} value={draft.contact_details} onChange={e => set('contact_details', e.target.value)} />
          </div>
          <div className={formStyles.row2}>
            <div className={styles.field}>
              <label>Name of Electrical Worker</label>
              <input value={draft.electrical_worker_name} onChange={e => set('electrical_worker_name', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Registration / Practising Licence Number</label>
              <input value={draft.licence_number} onChange={e => set('licence_number', e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Phone & Email</label>
            <input value={draft.phone_email} onChange={e => set('phone_email', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Name and Registration Number of Person(s) Supervised</label>
            <textarea rows={2} value={draft.supervised_persons} onChange={e => set('supervised_persons', e.target.value)} />
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Certificate of Compliance</h4>

          <div className={styles.field}>
            <label>Type of Work</label>
            <CheckGroup value={draft.work_type} onChange={v => set('work_type', v)}
              options={[['addition', 'Addition'], ['alteration', 'Alteration'], ['new_work', 'New work']]} />
          </div>

          <div className={styles.field}>
            <label>The Prescribed Electrical Work Is</label>
            <CheckGroup value={draft.risk_level} onChange={v => set('risk_level', v)}
              options={[['low_risk', 'Low risk'], ['general', 'General'], ['high_risk', 'High-risk']]} />
          </div>
          {draft.risk_level === 'high_risk' && (
            <div className={styles.field}>
              <label>High-risk — Specify</label>
              <input value={draft.high_risk_detail} onChange={e => set('high_risk_detail', e.target.value)} />
            </div>
          )}

          <div className={styles.field}>
            <label>Means of Compliance</label>
            <CheckGroup value={draft.compliance_part} onChange={v => set('compliance_part', v)}
              options={[['part1', 'Part 1 of AS/NZS 3000'], ['part2', 'Part 2 of AS/NZS 3000']]} />
          </div>

          <div className={styles.field}>
            <label>Additional Standards or Electrical Code of Practice Were Required?</label>
            <YesNo value={draft.additional_standards_required} onChange={v => set('additional_standards_required', v)} />
          </div>
          {draft.additional_standards_required && (
            <div className={styles.field}>
              <label>Additional Standards — Specify</label>
              <input value={draft.additional_standards_detail} onChange={e => set('additional_standards_detail', e.target.value)} />
            </div>
          )}

          <div className={styles.field}>
            <label>Date or Range of Dates Prescribed Electrical Work Undertaken</label>
            <input value={draft.work_date_range} onChange={e => set('work_date_range', e.target.value)} />
          </div>

          <div className={styles.field}>
            <label>Contains Fittings That Are Safe to Connect to a Power Supply?</label>
            <YesNo value={draft.fittings_safe} onChange={v => set('fittings_safe', v)} />
          </div>

          <div className={styles.field}>
            <label>Specify Type of Supply System</label>
            <input value={draft.supply_system_type} onChange={e => set('supply_system_type', e.target.value)} />
          </div>

          <div className={styles.field}>
            <label>The Installation Has an Earthing System That Is Correctly Rated (Where Applicable)</label>
            <YesNo value={draft.earthing_correctly_rated} onChange={v => set('earthing_correctly_rated', v)} />
          </div>

          <div className={styles.field}>
            <label>Parts of the Installation That Are Safe to Connect to a Power Supply</label>
            <CheckGroup value={draft.parts_scope} onChange={v => set('parts_scope', v)}
              options={[['all', 'All'], ['parts', 'Parts']]} />
          </div>
          {draft.parts_scope === 'parts' && (
            <div className={styles.field}>
              <label>Parts — Specify</label>
              <input value={draft.parts_scope_detail} onChange={e => set('parts_scope_detail', e.target.value)} />
            </div>
          )}

          <div className={styles.field}>
            <label>The Work Relies on Manufacturer's Instructions</label>
            <YesNo value={draft.relies_on_manual} onChange={v => set('relies_on_manual', v)} />
          </div>
          {draft.relies_on_manual && (
            <div className={formStyles.row2}>
              <div className={styles.field}><label>Identify</label><input value={draft.manual_identify} onChange={e => set('manual_identify', e.target.value)} /></div>
              <div className={styles.field}><label>Link</label><input value={draft.manual_link} onChange={e => set('manual_link', e.target.value)} /></div>
            </div>
          )}

          <div className={styles.field}>
            <label>The Work Has Been Done in Accordance With a Certified Design</label>
            <YesNo value={draft.relies_on_certified_design} onChange={v => set('relies_on_certified_design', v)} />
          </div>
          {draft.relies_on_certified_design && (
            <div className={formStyles.row2}>
              <div className={styles.field}><label>Identify</label><input value={draft.design_identify} onChange={e => set('design_identify', e.target.value)} /></div>
              <div className={styles.field}><label>Link</label><input value={draft.design_link} onChange={e => set('design_link', e.target.value)} /></div>
            </div>
          )}

          <div className={styles.field}>
            <label>The Work Relies on a Supplier Declaration of Conformity (SDoC)</label>
            <YesNo value={draft.relies_on_sdoc} onChange={v => set('relies_on_sdoc', v)} />
          </div>
          {draft.relies_on_sdoc && (
            <div className={formStyles.row2}>
              <div className={styles.field}><label>Identify</label><input value={draft.sdoc_identify} onChange={e => set('sdoc_identify', e.target.value)} /></div>
              <div className={styles.field}><label>Link</label><input value={draft.sdoc_link} onChange={e => set('sdoc_link', e.target.value)} /></div>
            </div>
          )}

          <div className={styles.field}>
            <label>Installation Satisfactorily Tested per the Electricity (Safety) Regulations 2010</label>
            <YesNo value={draft.satisfactorily_tested} onChange={v => set('satisfactorily_tested', v)} />
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Description of Work & Test Results</h4>
          <div className={styles.field}>
            <label>Description of Work</label>
            <textarea rows={3} value={draft.description_of_work} onChange={e => set('description_of_work', e.target.value)} />
          </div>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Polarity (Independent Earth)</label><input value={draft.test_polarity} onChange={e => set('test_polarity', e.target.value)} /></div>
            <div className={styles.field}><label>Insulation Resistance (Ohms)</label><input value={draft.test_insulation_resistance} onChange={e => set('test_insulation_resistance', e.target.value)} /></div>
          </div>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Earth Continuity (Ohms)</label><input value={draft.test_earth_continuity} onChange={e => set('test_earth_continuity', e.target.value)} /></div>
            <div className={styles.field}><label>Bonding (Ohms)</label><input value={draft.test_bonding} onChange={e => set('test_bonding', e.target.value)} /></div>
          </div>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Fault Loop Impedance (Ohms)</label><input value={draft.test_fault_loop_impedance} onChange={e => set('test_fault_loop_impedance', e.target.value)} /></div>
            <div className={styles.field}><label>Other (Specify)</label><input value={draft.test_other} onChange={e => set('test_other', e.target.value)} /></div>
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Certificate of Compliance Sign-Off</h4>
          <p className={formStyles.hint}>By typing your name below you certify the completed prescribed electrical work has been done lawfully and safely, and the information in this certificate is correct.</p>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Certifier's Signature (type full name)</label><input value={draft.coc_certifier_signature} onChange={e => set('coc_certifier_signature', e.target.value)} /></div>
            <div className={styles.field}><label>Date</label><input type="date" value={draft.coc_signed_date} onChange={e => set('coc_signed_date', e.target.value)} /></div>
          </div>
        </div>

        <div className={formStyles.section}>
          <h4 className={formStyles.sectionTitle}>Electrical Safety Certificate</h4>
          <p className={formStyles.hint}>By typing your name below you certify the installation (or part of it) is connected to a power supply and is safe to use.</p>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Certifier's Name</label><input value={draft.esc_certifier_name} onChange={e => set('esc_certifier_name', e.target.value)} /></div>
            <div className={styles.field}><label>Registration / Practising Licence Number</label><input value={draft.esc_licence_number} onChange={e => set('esc_licence_number', e.target.value)} /></div>
          </div>
          <div className={formStyles.row2}>
            <div className={styles.field}><label>Certifier's Signature (type full name)</label><input value={draft.esc_certifier_signature} onChange={e => set('esc_certifier_signature', e.target.value)} /></div>
            <div className={styles.field}><label>Certificate Issue Date</label><input type="date" value={draft.esc_issue_date} onChange={e => set('esc_issue_date', e.target.value)} /></div>
          </div>
          <div className={styles.field}>
            <label>Connection Date</label>
            <input type="date" value={draft.esc_connection_date} onChange={e => set('esc_connection_date', e.target.value)} />
          </div>
        </div>

        <div className={styles.formActions} style={{ padding: 20, borderTop: '1px solid var(--color-border)' }}>
          {form && <button type="button" className={styles.btnSecondary} onClick={() => { setDraft(normaliseForDraft(form)); setEditing(false); }}>Cancel</button>}
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? 'Saving…' : form ? 'Save Changes' : '✓ Submit Certificate'}
          </button>
        </div>
      </form>
    </div>
  );
}
