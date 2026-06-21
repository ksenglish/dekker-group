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

const TECH_COLOURS = ['#1e40af','#0891b2','#7c3aed','#16a34a','#d97706','#dc2626','#9333ea','#0f766e'];

export default function SchedulePage() {
  const { user } = useAuth();
  const calRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [techMap, setTechMap] = useState({});
  const [filterTech, setFilterTech] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  // fcEvents drives the calendar — plain state array, replaced on every fetch
  const [fcEvents, setFcEvents] = useState([]);
  const viewKey = user ? `schedule_view_${user.id}` : 'schedule_view';
  const [view, setView] = useState(() => localStorage.getItem(viewKey) || 'dayGridMonth');

  // Auto-open assign modal if ?job= param present
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (jobId) setAssignTarget({ jobId, date: new Date().toISOString().split('T')[0] });
  }, []);

  useEffect(() => {
    api.get('/users').then(r => {
      const map = {};
      r.data.forEach(u => { map[u.id] = u.name; });
      setTechMap(map);
    }).catch(() => {});
  }, []);

  function techColour(userId, map) {
    const keys = Object.keys(map);
    const idx = keys.indexOf(userId);
    return TECH_COLOURS[idx >= 0 ? idx % TECH_COLOURS.length : 0];
  }

  function toFcEvents(rows, map, tech) {
    return rows
      .filter(s => !tech || s.user_id === tech)
      .map(s => {
        const d = s.scheduled_date.split('T')[0]; // strip Postgres timestamp
        const colour = techColour(s.user_id, map);
        return {
          id: `sched-${s.id}`,
          title: `#${s.job_number} ${s.customer_name || ''} — ${s.tech_name || ''}`,
          start: s.start_time ? `${d}T${s.start_time}` : d,
          end:   s.end_time   ? `${d}T${s.end_time}`   : undefined,
          allDay: !s.start_time,
          backgroundColor: colour,
          borderColor: colour,
          extendedProps: { ...s, schedId: s.id, type: 'scheduled' },
        };
      });
  }

  function loadSchedules(map, tech) {
    const resolvedMap  = map  !== undefined ? map  : techMap;
    const resolvedTech = tech !== undefined ? tech : filterTech;
    api.get('/schedules').then(r => {
      setFcEvents(toFcEvents(r.data, resolvedMap, resolvedTech));
    }).catch(() => {});
  }

  useEffect(() => { loadSchedules(); }, []);

  // Re-filter when filter changes (no new fetch needed)
  // Re-load when techMap arrives so colours are correct
  useEffect(() => { loadSchedules(techMap, filterTech); }, [techMap, filterTech]);

  async function handleEventDrop({ event, revert }) {
    const { job_id } = event.extendedProps;
    if (!job_id) return;
    try {
      await api.patch(`/schedules/jobs/${job_id}/reschedule`, { date: event.startStr.split('T')[0] });
      loadSchedules();
    } catch { revert(); }
  }

  function handleEventClick({ event }) { setSelectedEvent(event.extendedProps); }

  function handleDateClick({ dateStr }) {
    if (user?.role === 'field_tech') return;
    setAssignTarget({ date: dateStr.split('T')[0], jobId: searchParams.get('job') || undefined });
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
              {Object.entries(techMap).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      </div>

      {Object.keys(techMap).length > 0 && (
        <div className={styles.legend}>
          {Object.entries(techMap).map(([id, name]) => (
            <div key={id} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: techColour(id, techMap) }} />
              {name}
            </div>
          ))}
        </div>
      )}

      <div className={styles.calendarWrap}>
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          height="100%"
          expandRows
          editable={canEdit}
          droppable={canEdit}
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          events={fcEvents}
          eventDisplay="block"
          dayMaxEvents={4}
          slotMinTime="07:00:00"
          slotMaxTime="20:30:00"
          nowIndicator
          firstDay={1}
          locale="en-NZ"
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          viewDidMount={info => { setView(info.view.type); localStorage.setItem(viewKey, info.view.type); }}
          eventDidMount={({ el, event }) => { el.title = event.title; }}
        />
      </div>

      {selectedEvent && (
        <div className={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Job #{selectedEvent.job_number}</h2>
              <button className={styles.modalClose} onClick={() => setSelectedEvent(null)}>✕</button>
            </div>
            <div className={styles.eventDetails}>
              <div className={styles.eventRow}><span>Customer</span><strong>{selectedEvent.customer_name || '—'}</strong></div>
              <div className={styles.eventRow}><span>Type</span><strong>{selectedEvent.job_type?.replace('_',' ')}</strong></div>
              {selectedEvent.tech_name && <div className={styles.eventRow}><span>Team Member</span><strong>{selectedEvent.tech_name}</strong></div>}
              <div className={styles.eventRow}><span>Date</span><strong>{new Date(selectedEvent.scheduled_date).toLocaleDateString('en-NZ')}</strong></div>
              {selectedEvent.start_time && <div className={styles.eventRow}><span>Time</span><strong>{selectedEvent.start_time}{selectedEvent.end_time ? ` – ${selectedEvent.end_time}` : ''}</strong></div>}
              {selectedEvent.description && <div className={styles.eventRow}><span>Notes</span><strong>{selectedEvent.description}</strong></div>}
              <div className={styles.eventRow}><span>Status</span><strong style={{ textTransform:'capitalize' }}>{selectedEvent.status?.replace('_',' ')}</strong></div>
            </div>
            <div className={styles.modalFooter}>
              <Link to={`/jobs/${selectedEvent.job_id}`} className={styles.btnSecondary} onClick={() => setSelectedEvent(null)}>View Job</Link>
              {canEdit && selectedEvent.schedId && (
                <button className={styles.btnDanger} onClick={async () => {
                  if (!confirm('Remove this appointment from the schedule?')) return;
                  await api.delete(`/schedules/${selectedEvent.schedId}`);
                  setSelectedEvent(null);
                  loadSchedules();
                }}>Delete Appt</button>
              )}
            </div>
          </div>
        </div>
      )}

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
