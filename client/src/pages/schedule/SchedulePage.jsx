import { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import AssignModal from './AssignModal';
import styles from './Schedule.module.css';

const TECH_COLOURS = [
  '#1e40af', '#0891b2', '#7c3aed', '#16a34a',
  '#d97706', '#dc2626', '#9333ea', '#0f766e',
];

export default function SchedulePage() {
  const { user } = useAuth();
  const calRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [rawSchedules, setRawSchedules] = useState([]);
  const [techMap, setTechMap] = useState({});
  const [filterTech, setFilterTech] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const viewKey = user ? `schedule_view_${user.id}` : 'schedule_view';
  const [view, setView] = useState(() => localStorage.getItem(viewKey) || 'dayGridMonth');

  // Auto-open assign modal if ?job= param present
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (jobId) {
      const today = new Date().toISOString().split('T')[0];
      setAssignTarget({ jobId, date: today });
    }
  }, []);

  // Load techs once
  useEffect(() => {
    api.get('/users').then(r => {
      const map = {};
      r.data.forEach(u => { map[u.id] = u.name; });
      setTechMap(map);
    }).catch(() => {});
  }, []);

  // Fetch all schedules — simple, no date range needed
  function loadSchedules() {
    console.log('[Schedule] Loading schedules...');
    api.get('/schedules')
      .then(r => {
        console.log('[Schedule] Got schedules:', r.data.length, r.data);
        setRawSchedules(r.data);
      })
      .catch(err => console.error('[Schedule] Load error:', err.response?.status, err.response?.data));
  }

  useEffect(() => { loadSchedules(); }, []);

  // Build FullCalendar event objects from raw schedule rows
  const techKeys = Object.keys(techMap);
  function techColour(userId) {
    const idx = techKeys.indexOf(userId);
    return TECH_COLOURS[idx >= 0 ? idx % TECH_COLOURS.length : 0];
  }

  const events = rawSchedules
    .filter(s => !filterTech || s.user_id === filterTech)
    .map(s => ({
      id: `sched-${s.id}`,
      schedId: s.id,
      jobId: s.job_id,
      title: `#${s.job_number} ${s.customer_name || ''} — ${s.tech_name || ''}`,
      start: s.start_time ? `${s.scheduled_date}T${s.start_time}` : s.scheduled_date,
      end: s.end_time ? `${s.scheduled_date}T${s.end_time}` : undefined,
      allDay: !s.start_time,
      backgroundColor: techColour(s.user_id),
      borderColor: techColour(s.user_id),
      extendedProps: { ...s, type: 'scheduled' },
    }));

  async function handleEventDrop({ event, revert }) {
    const { jobId } = event.extendedProps;
    if (!jobId) return;
    const date = event.startStr.split('T')[0];
    try {
      await api.patch(`/schedules/jobs/${jobId}/reschedule`, { date });
      loadSchedules();
    } catch {
      revert();
    }
  }

  function handleEventClick({ event }) {
    setSelectedEvent(event.extendedProps);
  }

  function handleDateClick({ dateStr }) {
    if (user?.role === 'field_tech') return;
    const jobId = searchParams.get('job') || undefined;
    setAssignTarget({ date: dateStr.split('T')[0], jobId });
  }

  function handleAssigned() {
    setAssignTarget(null);
    loadSchedules();
  }

  const canEdit = user?.role !== 'field_tech';

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Schedule</h1>
          <p className={styles.pageSubtitle}>Click a date to schedule a job · Drag to reschedule</p>
        </div>
        <div className={styles.headerActions}>
          {Object.keys(techMap).length > 0 && (
            <select className={styles.filterSelect} value={filterTech} onChange={e => setFilterTech(e.target.value)}>
              <option value="">All team members</option>
              {Object.entries(techMap).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Legend */}
      {Object.keys(techMap).length > 0 && (
        <div className={styles.legend}>
          {Object.entries(techMap).map(([id, name]) => (
            <div key={id} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: techColour(id) }} />
              {name}
            </div>
          ))}
        </div>
      )}

      {/* DEBUG — remove once calendar is confirmed working */}
      <div style={{ fontSize: 12, color: '#64748b', padding: '4px 0 8px', fontFamily: 'monospace' }}>
        Schedule entries loaded: {rawSchedules.length} | Showing: {events.length}
      </div>

      <div className={styles.calendarWrap}>
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          height="auto"
          editable={canEdit}
          droppable={canEdit}
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          events={events}
          eventDisplay="block"
          dayMaxEvents={4}
          slotMinTime="07:00:00"
          slotMaxTime="20:30:00"
          nowIndicator
          firstDay={1}
          locale="en-NZ"
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          viewDidMount={info => {
            setView(info.view.type);
            localStorage.setItem(viewKey, info.view.type);
          }}
          eventDidMount={({ el, event }) => {
            el.title = event.title;
          }}
        />
      </div>

      {/* Event detail popup */}
      {selectedEvent && (
        <div className={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Job #{selectedEvent.job_number}</h2>
              <button className={styles.modalClose} onClick={() => setSelectedEvent(null)}>✕</button>
            </div>
            <div className={styles.eventDetails}>
              <div className={styles.eventRow}><span>Customer</span><strong>{selectedEvent.customer_name || '—'}</strong></div>
              <div className={styles.eventRow}><span>Type</span><strong style={{ textTransform: 'capitalize' }}>{selectedEvent.job_type?.replace('_', ' ')}</strong></div>
              {selectedEvent.tech_name && <div className={styles.eventRow}><span>Team Member</span><strong>{selectedEvent.tech_name}</strong></div>}
              <div className={styles.eventRow}><span>Date</span>
                <strong>{new Date(selectedEvent.scheduled_date).toLocaleDateString('en-NZ')}</strong>
              </div>
              {selectedEvent.start_time && (
                <div className={styles.eventRow}><span>Time</span>
                  <strong>{selectedEvent.start_time}{selectedEvent.end_time ? ` – ${selectedEvent.end_time}` : ''}</strong>
                </div>
              )}
              {selectedEvent.description && <div className={styles.eventRow}><span>Notes</span><strong>{selectedEvent.description}</strong></div>}
              <div className={styles.eventRow}><span>Status</span>
                <strong style={{ textTransform: 'capitalize' }}>{selectedEvent.status?.replace('_', ' ')}</strong>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <Link to={`/jobs/${selectedEvent.job_id}`} className={styles.btnSecondary} onClick={() => setSelectedEvent(null)}>
                View Job
              </Link>
              {canEdit && selectedEvent.schedId && (
                <button className={styles.btnDanger} onClick={async () => {
                  await api.delete(`/schedules/${selectedEvent.schedId}`);
                  setSelectedEvent(null);
                  loadSchedules();
                }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {assignTarget && (
        <AssignModal
          date={assignTarget.date}
          jobId={assignTarget.jobId}
          techMap={techMap}
          onClose={() => setAssignTarget(null)}
          onAssigned={handleAssigned}
        />
      )}
    </div>
  );
}
