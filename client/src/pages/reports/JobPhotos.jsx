import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Reports.module.css';

// Photos taken on site, from completed jobs only, filed the way someone looking
// for them would go about it: which part of the business, then which job, then
// before or after the work.
//
// They are on the job already, but one job at a time and three tabs deep. This
// is the shelf you browse when you want a picture of a finished install and
// don't yet know which job it was.

const fmtDate = d => (d
  ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  : null);

const jobLabel = j => j.external_ref || (j.job_number ? `JB${String(j.job_number).padStart(5, '0')}` : 'Job');

// The photo endpoint needs the auth header, so an <img src> pointed straight at
// it gets a 401 — each one is fetched as a blob instead. Loaded only when its
// branch is opened, which is the point of the tree.
function Photo({ photo, onOpen }) {
  const [url, setUrl] = useState(photo.inline || null);

  useEffect(() => {
    if (photo.inline || !photo.photo_key) return;
    let objectUrl;
    api.get('/forms/photos', { params: { key: photo.photo_key }, responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.photo_key, photo.inline]);

  if (!url) return <div className={styles.photoTileLoading} />;
  return (
    <figure className={styles.photoTile}>
      <img src={url} alt={photo.filename || photo.field_label || 'Job photo'}
        onClick={() => onOpen({ ...photo, url })} />
      <figcaption>{photo.field_label || photo.form_name}</figcaption>
    </figure>
  );
}

function StageBranch({ label, photos, openStage, setOpenStage, stageKey, onOpen }) {
  const open = openStage === stageKey;
  if (!photos.length) return null;
  return (
    <div className={styles.photoStage}>
      <button className={styles.photoStageHead} onClick={() => setOpenStage(open ? null : stageKey)}>
        <span className={styles.treeArrow}>{open ? '▾' : '▸'}</span>
        {label}
        <em>{photos.length} photo{photos.length === 1 ? '' : 's'}</em>
      </button>
      {open && (
        <div className={styles.photoGrid}>
          {photos.map((p, i) => <Photo key={p.photo_key || `i${i}`} photo={p} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function JobBranch({ job, onOpenPhoto }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState(null);
  const [openStage, setOpenStage] = useState(null);
  const loaded = useRef(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || loaded.current) return;
    loaded.current = true;
    try {
      const { data } = await api.get(`/reports/job-photos/${job.id}`);
      setPhotos(data);
      // A job usually has one or the other, so the only branch with anything
      // in it opens itself rather than asking for a second click.
      if (data.pre_install.length && !data.post_install.length) setOpenStage('pre');
      else if (data.post_install.length && !data.pre_install.length) setOpenStage('post');
    } catch { setPhotos({ pre_install: [], post_install: [] }); }
  }

  return (
    <div className={styles.photoJob}>
      <button className={styles.photoJobHead} onClick={toggle}>
        <span className={styles.treeArrow}>{open ? '▾' : '▸'}</span>
        <strong>{jobLabel(job)}</strong>
        <span className={styles.photoJobWho}>
          {[job.customer_name, job.description].filter(Boolean).join(' · ')}
        </span>
        <em>
          {job.photo_count} photo{job.photo_count === 1 ? '' : 's'}
          {fmtDate(job.completed_at) && ` · completed ${fmtDate(job.completed_at)}`}
        </em>
      </button>

      {open && (
        <div className={styles.photoStages}>
          {!photos ? (
            <div className={styles.emptySmall}>Loading…</div>
          ) : (
            <>
              <StageBranch label="Pre-Install Forms" stageKey="pre" photos={photos.pre_install}
                openStage={openStage} setOpenStage={setOpenStage} onOpen={onOpenPhoto} />
              <StageBranch label="Post-Install Forms" stageKey="post" photos={photos.post_install}
                openStage={openStage} setOpenStage={setOpenStage} onOpen={onOpenPhoto} />
            </>
          )}
          <Link to={`/jobs/${job.id}`} className={styles.photoJobLink}>Open this job →</Link>
        </div>
      )}
    </div>
  );
}

export default function JobPhotos() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openType, setOpenType] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/reports/job-photos')
      .then(r => {
        setTypes(r.data);
        // One job type is the common case; opening it saves a pointless click.
        if (r.data.length === 1) setOpenType(r.data[0].job_type);
      })
      .catch(() => setTypes([]))
      .finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = !q ? types : types
    .map(t => ({
      ...t,
      jobs: t.jobs.filter(j => [jobLabel(j), j.customer_name, j.description]
        .filter(Boolean).some(v => v.toLowerCase().includes(q))),
    }))
    .filter(t => t.jobs.length);

  const totalPhotos = types.reduce((s, t) => s + t.photo_count, 0);

  if (loading) return <div className={styles.emptySmall}>Loading…</div>;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2>Job Photos</h2>
        <input className={styles.photoSearch} value={search} placeholder="Find a job number or customer…"
          onChange={e => setSearch(e.target.value)} />
      </div>

      {types.length === 0 ? (
        <div className={styles.emptySmall}>
          No photos yet. They appear here once a job with photos on its forms is marked Complete.
        </div>
      ) : (
        <>
          <div className={styles.photoCount}>
            {totalPhotos} photo{totalPhotos === 1 ? '' : 's'} across {types.reduce((s, t) => s + t.job_count, 0)} completed jobs
          </div>

          {shown.length === 0 ? (
            <div className={styles.emptySmall}>No completed job matches “{search}”.</div>
          ) : shown.map(t => {
            const open = openType === t.job_type || !!q;
            return (
              <div key={t.job_type} className={styles.photoType}>
                <button className={styles.photoTypeHead}
                  onClick={() => setOpenType(open && !q ? null : t.job_type)}>
                  <span className={styles.treeArrow}>{open ? '▾' : '▸'}</span>
                  {t.job_type}
                  <em>{t.jobs.length} job{t.jobs.length === 1 ? '' : 's'} · {t.photo_count} photo{t.photo_count === 1 ? '' : 's'}</em>
                </button>
                {open && (
                  <div className={styles.photoJobs}>
                    {t.jobs.map(j => <JobBranch key={j.id} job={j} onOpenPhoto={setLightbox} />)}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {lightbox && (
        <div className={styles.photoLightbox} onClick={() => setLightbox(null)}>
          <button className={styles.photoLightboxClose} onClick={() => setLightbox(null)}>✕</button>
          <img src={lightbox.url} alt={lightbox.filename || 'Job photo'} onClick={e => e.stopPropagation()} />
          <div className={styles.photoLightboxHint}>
            {[lightbox.form_name, lightbox.field_label].filter(Boolean).join(' · ')}
            {/* Right-click → Save image. A download button would need the blob
                fetched a second time for no gain. */}
            <span> — click outside to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
