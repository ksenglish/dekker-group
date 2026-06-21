import { useState, useEffect, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import AssignModal from './AssignModal';
import styles from './Schedule.module.css';

// Stable palette — one colour per technician
const TECH_COLOURS = [
  '#1e40af', '#0891b2', '#7c3aed', '#16a34a',
  '#d97706', '#dc2626', '#9333ea', '#0f766e',
];

function techColour(techId, techMap) {
  const keys = Object.keys(techMap);
  const idx = keys.indexOf(techId);
  return TECH_COLOURS[idx % TECH_COLOURS.length] || '#1e40af';
}

export default function SchedulePage() {
  const { user } = useAuth();
  const calRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [techMap, setTechMap] = useState({});   // id -> name
  const [filterTech, setFilterTech] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null); // { jobId, date } for new assignment
  const viewKey = user ? `schedule_view_${user.id}` : 'schedule_view';
  const [view, setView] = useState(() => localStorage.getItem(viewKey) || 'dayGridMonth');

  // Load techs
  useEffect(() => {
    api.get('/users').then(r => {
      const map = {};
      r.data.filter(u => u.role !== 'office').forEach(u => { map[u.id] = u.name; });
      setTechMap(map);
    }).catch(() => {});
  }, []);

  // Load schedule + unscheduled jobs with due dates
  const loadEvents = useCallback(async (fetchInfo) => {
    const from = fetchInfo?.startStr?.split('T')[0];
    const to = fetchInfo?.endStr?.split('T')[0];

    try {
      const [schedRes, jobsRes] = await Promise.all([
        api.get('/schedules', { params: { from, to, ...(filterTech ? { tech: filterTech } : {}) } }),
        api.get('/jobs', { params: { from, to, limit: 200 } }),
      ]);

      const scheduledJobIds = new Set(schedRes.data.map(s => s.job_id));

      // Scheduled events
      const schedEvents = schedRes.data.map(s => ({
        id: `sched-${s.id}`,
        schedId: s.id,
        jobId: s.job_id,
        title: `#${s.job_number} ${s.customer_name || ''} — ${s.tech_name}`,
        start: s.start_time ? `${s.scheduled_date}T${s.start_time}` : s.scheduled_date,
        end: s.end_time ? `${s.scheduled_date}T${s.end_time}` : undefined,
        allDay: !s.start_time,
        backgroundColor: techColour(s.user_id, techMap),
        borderColor: techColour(s.user_id, techMap),
        extendedProps: { ...s, type: 'scheduled' },
      }));

      // Unscheduled jobs with due dates shown as grey placeholders
      const unscheduledEvents = jobsRes.data.jobs
        .filter(j => !scheduledJobIds.has(j.id) && j.due_date && j.status !== 'complete' && j.status !== 'cancelled')
        .map(j => ({
          id: `job-${j.id}`,
          jobId: j.id,
          title: `#${j.job_number} ${j.customer_name || ''} (unscheduled)`,
          start: j.due_date,
          allDay: true,
          backgroundColor: '#94a3b8',
          borderColor: '#94a3b8',
          extendedProps: { ...j, type: 'unscheduled' },
        }));

      return [...schedEvents, ...unscheduledEvents];
    } catch {
      return [];
    }
  }, [filterTech, techMap]);

  // Refetch when filter or techMap changes
  useEffect(() => {
    const cal = calRef.current?.getApi();
    if (!cal) return;
    const info = cal.currentData?.dateProfile;
    if (!info) { cal.refetchEvents(); return; }
    cal.refetchEvents();
  }, [filterTech, techMap]);

  async function handleEventDrop({ event, revert }) {
    const { jobId, type } = event.extendedProps;
    if (!jobId) return;
    const date = event.startStr.split('T')[0];
    try {
      await api.patch(`/schedules/jobs/${jobId}/reschedule`, { date });
    } catch {
      revert();
    }
  }

  function handleEventClick({ event }) {
    setSelectedEvent(event.extendedProps);
  }

  function handleDateClick({ dateStr }) {
    if (user?.role === 'field_tech') return;
    // Open assign modal for this date
    setAssignTarget({ date: dateStr });
  }

  function handleAssigned() {
    setAssignTarget(null);
    calRef.current?.getApi().refetchEvents();
  }

  const canEdit = user?.role !== 'field_tech';

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Schedule</h1>
          <p className={styles.pageSubtitle}>Drag jobs to reschedule · Click a date to assign</p>
        </div>
        <div className={styles.headerActions}>
          {Object.keys(techMap).length > 0 && (
            <select className={styles.filterSelect} value={filterTech} onChange={e => setFilterTech(e.target.value)}>
              <option value="">All technicians</option>
              {Object.entries(techMap).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Technician legend */}
      {Object.keys(techMap).length > 0 && (
        <div className={styles.legend}>
          {Object.entries(techMap).map(([id, name]) => (
            <div key={id} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: techColour(id, techMap) }} />
              {name}
            </div>
          ))}
          <div className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#94a3b8' }} />
            Unscheduled (due date)
          </div>
        </div>
      )}

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
          events={loadEvents}
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
              <div className={styles.eventRow}><span>Type</span><strong style={{ textTransform: 'capitalize' }}>{selectedEvent.type?.replace('_', ' ')}</strong></div>
              {selectedEvent.tech_name && <div className={styles.eventRow}><span>Technician</span><strong>{selectedEvent.tech_name}</strong></div>}
              <div className={styles.eventRow}><span>Date</span><strong>{new Date(selectedEvent.scheduled_date || selectedEvent.due_date).toLocaleDateString('en-NZ')}</strong></div>
              {selectedEvent.description && <div className={styles.eventRow}><span>Description</span><strong>{selectedEvent.description}</strong></div>}
              <div className={styles.eventRow}><span>Status</span>
                <strong style={{ textTransform: 'capitalize' }}>{selectedEvent.status?.replace('_', ' ')}</strong>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <Link to={`/jobs/${selectedEvent.job_id || selectedEvent.id}`} className={styles.btnSecondary} onClick={() => setSelectedEvent(null)}>
                View Job
              </Link>
              {canEdit && selectedEvent.type === 'unscheduled' && (
                <button className={styles.btnPrimary} onClick={() => {
                  setSelectedEvent(null);
                  setAssignTarget({ date: selectedEvent.due_date, jobId: selectedEvent.job_id || selectedEvent.id });
                }}>
                  Assign Tech
                </button>
              )}
              {canEdit && selectedEvent.schedId && (
                <button className={styles.btnDanger} onClick={async () => {
                  await api.delete(`/schedules/${selectedEvent.schedId}`);
                  setSelectedEvent(null);
                  calRef.current?.getApi().refetchEvents();
                }}>
                  Unschedule
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
