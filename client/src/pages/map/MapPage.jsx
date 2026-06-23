import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../lib/api';
import styles from './Map.module.css';

// Fix Leaflet's broken default icon paths when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl:       new URL('leaflet/dist/images/marker-icon.png',    import.meta.url).href,
  shadowUrl:     new URL('leaflet/dist/images/marker-shadow.png',  import.meta.url).href,
});

const STATUS_COLOURS = {
  pending:     '#6b7280',
  quoted:      '#0891b2',
  scheduled:   '#7c3aed',
  in_progress: '#d97706',
  complete:    '#16a34a',
  cancelled:   '#9ca3af',
};

const STATUS_LABELS = {
  pending: 'Pending', quoted: 'Quoted', scheduled: 'Scheduled',
  in_progress: 'In Progress', complete: 'Complete', cancelled: 'Cancelled',
};

// Default center: Auckland, NZ
const DEFAULT_CENTER = [-36.8485, 174.7633];

export default function MapPage() {
  const navigate = useNavigate();
  const mapRef      = useRef(null);   // DOM element
  const mapInstance = useRef(null);   // L.Map instance
  const markersRef  = useRef([]);

  const [jobs, setJobs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('active');
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [geocoding, setGeocoding]     = useState(false);
  const [geocodeMsg, setGeocodeMsg]   = useState('');

  useEffect(() => {
    api.get('/jobs', { params: { limit: 1000 } })
      .then(r => setJobs(r.data?.jobs || r.data || []))
      .finally(() => setLoading(false));
  }, []);

  // Initialise map once the DOM node is ready
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(mapInstance.current);
    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  const visibleJobs = jobs.filter(j => {
    const matchesFilter =
      statusFilter === 'all'    ? true :
      statusFilter === 'active' ? !['complete','cancelled'].includes(j.status) :
      j.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      j.description?.toLowerCase().includes(q) ||
      j.customer_name?.toLowerCase().includes(q) ||
      j.site_address?.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const jobsWithLocation    = visibleJobs.filter(j => j.site_lat && j.site_lng);
  const jobsWithoutLocation = visibleJobs.filter(j => !j.site_lat || !j.site_lng);

  // Re-draw markers whenever visible jobs change
  useEffect(() => {
    if (!mapInstance.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = [];
    jobsWithLocation.forEach(job => {
      const lat = parseFloat(job.site_lat);
      const lng = parseFloat(job.site_lng);
      const colour = STATUS_COLOURS[job.status] || '#6b7280';
      const marker = L.circleMarker([lat, lng], {
        radius: 10, fillColor: colour, fillOpacity: 0.9,
        color: 'white', weight: 2,
      }).addTo(mapInstance.current);

      marker.bindPopup(`
        <div style="min-width:200px;font-family:sans-serif;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">#${job.job_number} — ${job.description || 'Job'}</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${job.customer_name || ''}</div>
          <div style="font-size:12px;margin-bottom:8px;">${job.site_address || ''}</div>
          <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:${colour}18;color:${colour};">
            ${STATUS_LABELS[job.status] || job.status}
          </span>
          <div style="margin-top:10px;">
            <a href="/jobs/${job.id}" style="font-size:12px;color:#0891b2;">View Job →</a>
          </div>
        </div>
      `);
      marker.on('click', () => setSelectedJob(job));
      markersRef.current.push(marker);
      bounds.push([lat, lng]);
    });

    if (bounds.length) {
      mapInstance.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [visibleJobs]);

  async function geocodeJobs() {
    setGeocoding(true);
    setGeocodeMsg('');
    let updated = 0;
    let failed  = 0;
    for (const job of jobsWithoutLocation) {
      if (!job.site_address) continue;
      try {
        const { data } = await api.post('/jobs/geocode', {
          address: job.site_address,
          site_id: job.site_id,
        });
        if (data.lat) {
          setJobs(prev => prev.map(j =>
            j.id === job.id ? { ...j, site_lat: data.lat, site_lng: data.lng } : j
          ));
          updated++;
        } else { failed++; }
      } catch { failed++; }
      // Nominatim requires 1 req/sec
      await new Promise(r => setTimeout(r, 1100));
    }
    setGeocoding(false);
    setGeocodeMsg(
      updated > 0
        ? `✓ ${updated} job${updated !== 1 ? 's' : ''} plotted${failed > 0 ? `, ${failed} address${failed !== 1 ? 'es' : ''} not found` : ''}`
        : `No addresses could be geocoded${failed > 0 ? ` (${failed} not found)` : ''}`
    );
    setTimeout(() => setGeocodeMsg(''), 6000);
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Map</h1>
          <p className={styles.pageSubtitle}>
            {jobsWithLocation.length} of {visibleJobs.length} jobs plotted
          </p>
        </div>
        <div className={styles.headerActions}>
          {geocodeMsg && <span className={styles.geocodeMsg}>{geocodeMsg}</span>}
          {jobsWithoutLocation.filter(j => j.site_address).length > 0 && (
            <button className={styles.btnSecondary} onClick={geocodeJobs} disabled={geocoding}>
              {geocoding
                ? `Geocoding… (${jobsWithoutLocation.filter(j=>j.site_address).length} remaining)`
                : `📍 Geocode ${jobsWithoutLocation.filter(j=>j.site_address).length} missing`}
            </button>
          )}
        </div>
      </div>

      {/* Status filter chips */}
      <div className={styles.controls}>
        <div className={styles.statusFilters}>
          {[
            { key: 'active', label: 'Active Jobs' },
            { key: 'all',    label: 'All Jobs' },
            ...Object.entries(STATUS_LABELS).map(([k, l]) => ({ key: k, label: l })),
          ].map(f => (
            <button key={f.key}
              className={`${styles.filterBtn} ${statusFilter === f.key ? styles.filterBtnActive : ''}`}
              onClick={() => setStatusFilter(f.key)}>
              {STATUS_COLOURS[f.key] && (
                <span className={styles.filterDot} style={{ background: STATUS_COLOURS[f.key] }} />
              )}
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" className={styles.searchInput}
          placeholder="Search jobs, customers, addresses…"
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      {/* Map + sidebar */}
      <div className={styles.mapLayout}>
        <div className={styles.mapWrap}>
          <div ref={mapRef} className={styles.leafletMap} />
        </div>

        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span>{visibleJobs.length} jobs</span>
            {jobsWithoutLocation.length > 0 && (
              <span className={styles.missingHint}>{jobsWithoutLocation.length} without location</span>
            )}
          </div>
          <div className={styles.jobList}>
            {visibleJobs.map(job => (
              <div key={job.id}
                className={`${styles.jobCard} ${selectedJob?.id === job.id ? styles.jobCardSelected : ''}`}
                onClick={() => navigate(`/jobs/${job.id}`)}>
                <div className={styles.jobCardTop}>
                  <span className={styles.jobNum}>#{job.job_number}</span>
                  <span className={styles.badge}
                    style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                    {STATUS_LABELS[job.status] || job.status}
                  </span>
                </div>
                <div className={styles.jobTitle}>{job.description || '—'}</div>
                <div className={styles.jobMeta}>{job.customer_name}</div>
                {job.site_address ? (
                  <div className={styles.jobAddr}>
                    <span className={job.site_lat ? styles.pinGreen : styles.pinGrey}>●</span>
                    {job.site_address}
                  </div>
                ) : (
                  <div className={`${styles.jobAddr} ${styles.noAddr}`}>No address</div>
                )}
              </div>
            ))}
            {visibleJobs.length === 0 && (
              <div className={styles.emptyList}>No jobs match this filter.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
