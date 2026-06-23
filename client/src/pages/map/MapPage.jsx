import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Map.module.css';

const STATUS_COLOURS = {
  pending: '#6b7280', quoted: '#0891b2', scheduled: '#7c3aed',
  in_progress: '#d97706', complete: '#16a34a', cancelled: '#9ca3af',
};

const STATUS_LABELS = {
  pending: 'Pending', quoted: 'Quoted', scheduled: 'Scheduled',
  in_progress: 'In Progress', complete: 'Complete', cancelled: 'Cancelled',
};

// Default center: Auckland, NZ
const DEFAULT_CENTER = { lat: -36.8485, lng: 174.7633 };

let gmapsLoaded = false;
let gmapsPromise = null;

function loadGoogleMaps(apiKey) {
  if (gmapsLoaded) return Promise.resolve();
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => { gmapsLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return gmapsPromise;
}

export default function MapPage() {
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);

  const [jobs, setJobs] = useState([]);
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // active | all | specific status
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [geocoding, setGeocoding] = useState(false);

  // Load API key + jobs on mount
  useEffect(() => {
    Promise.all([
      api.get('/settings/maps-key'),
      api.get('/jobs', { params: { limit: 1000 } }),
    ]).then(([keyRes, jobsRes]) => {
      setApiKey(keyRes.data.key || '');
      const allJobs = jobsRes.data?.jobs || jobsRes.data || [];
      setJobs(allJobs);
    }).catch(() => setMapError('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  const visibleJobs = jobs.filter(j => {
    const matchesFilter = statusFilter === 'all' ? true
      : statusFilter === 'active' ? !['complete', 'cancelled'].includes(j.status)
      : j.status === statusFilter;
    const matchesSearch = !searchQuery ||
      j.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.site_address?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const jobsWithLocation = visibleJobs.filter(j => j.site_lat && j.site_lng);
  const jobsWithoutLocation = visibleJobs.filter(j => !j.site_lat || !j.site_lng);

  const initMap = useCallback(async () => {
    if (!apiKey || !mapRef.current) return;
    try {
      await loadGoogleMaps(apiKey);
      const google = window.google;
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center: DEFAULT_CENTER, zoom: 10,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      });
      infoWindowRef.current = new google.maps.InfoWindow();
      placeMarkers();
    } catch (err) {
      setMapError('Google Maps failed to load. Check your API key in Settings → Integrations.');
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey) initMap();
  }, [apiKey, initMap]);

  // Re-place markers when jobs or filter changes
  useEffect(() => {
    if (mapInstanceRef.current) placeMarkers();
  }, [visibleJobs]);

  function placeMarkers() {
    const google = window.google;
    if (!google || !mapInstanceRef.current) return;
    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasMarkers = false;

    jobsWithLocation.forEach(job => {
      const pos = { lat: parseFloat(job.site_lat), lng: parseFloat(job.site_lng) };
      const colour = STATUS_COLOURS[job.status] || '#6b7280';
      const marker = new google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: job.description || 'Job',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: colour, fillOpacity: 1,
          strokeColor: 'white', strokeWeight: 2,
        },
      });
      marker.addListener('click', () => {
        const content = `
          <div style="max-width:240px;font-family:sans-serif;">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;">#${job.job_number} — ${job.description || 'Job'}</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${job.customer_name || ''}</div>
            <div style="font-size:12px;margin-bottom:6px;">${job.site_address || ''}</div>
            <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:${colour}18;color:${colour};">
              ${STATUS_LABELS[job.status] || job.status}
            </span>
            <div style="margin-top:10px;">
              <a href="/jobs/${job.id}" style="font-size:12px;color:#0891b2;">View Job →</a>
            </div>
          </div>
        `;
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.open(mapInstanceRef.current, marker);
        setSelectedJob(job);
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
      hasMarkers = true;
    });

    if (hasMarkers) {
      mapInstanceRef.current.fitBounds(bounds);
      const listener = mapInstanceRef.current.addListener('idle', () => {
        if (mapInstanceRef.current.getZoom() > 15) mapInstanceRef.current.setZoom(15);
        google.maps.event.removeListener(listener);
      });
    }
  }

  // Geocode all visible jobs that don't have lat/lng yet
  async function geocodeJobs() {
    if (!apiKey) return;
    setGeocoding(true);
    let updated = 0;
    for (const job of jobsWithoutLocation) {
      if (!job.site_address) continue;
      try {
        const { data } = await api.post('/jobs/geocode', { address: job.site_address, site_id: job.site_id });
        if (data.lat) {
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, site_lat: data.lat, site_lng: data.lng } : j));
          updated++;
        }
      } catch {}
    }
    setGeocoding(false);
    if (updated === 0) alert('No new locations could be geocoded.');
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading map…</div></div>;

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
          {jobsWithoutLocation.length > 0 && (
            <button className={styles.btnSecondary} onClick={geocodeJobs} disabled={geocoding || !apiKey}>
              {geocoding ? 'Geocoding…' : `📍 Geocode ${jobsWithoutLocation.length} missing`}
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.statusFilters}>
          {[
            { key: 'active', label: 'Active Jobs' },
            { key: 'all', label: 'All Jobs' },
            ...Object.entries(STATUS_LABELS).map(([k, l]) => ({ key: k, label: l })),
          ].map(f => (
            <button key={f.key}
              className={`${styles.filterBtn} ${statusFilter === f.key ? styles.filterBtnActive : ''}`}
              onClick={() => setStatusFilter(f.key)}>
              {f.key !== 'active' && f.key !== 'all' && (
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

      {/* Main layout: map + sidebar */}
      <div className={styles.mapLayout}>
        <div className={styles.mapWrap}>
          {!apiKey ? (
            <div className={styles.noApiKey}>
              <div className={styles.noApiIcon}>🗺</div>
              <h3>Google Maps API Key Required</h3>
              <p>Add your Google Maps API key in <strong>Settings → Integrations</strong> to enable the map view.</p>
              <button className={styles.btnPrimary} onClick={() => navigate('/settings')}>
                Go to Settings
              </button>
            </div>
          ) : mapError ? (
            <div className={styles.noApiKey}>
              <div className={styles.noApiIcon}>⚠</div>
              <h3>Map Error</h3>
              <p>{mapError}</p>
            </div>
          ) : (
            <div ref={mapRef} className={styles.googleMap} />
          )}
        </div>

        {/* Job list sidebar */}
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
                  <div className={styles.jobAddr + ' ' + styles.noAddr}>No address</div>
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
