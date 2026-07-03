import { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Link, useSearchParams } from 'react-router-dom';
import { formatJobNumber } from '../../lib/formatJobNumber';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import AssignModal from './AssignModal';
import DayColumnsView from './DayColumnsView';
import styles from './Schedule.module.css';

const TECH_COLOURS = ['#1e40af','#0891b2','#7c3aed','#16a34a','#d97706','#dc2626','#9333ea','#0f766e'];
const APPT_TYPE_LABEL = { sales: 'Sales', operations: 'Operations' };
const APPT_TYPE_COLOURS = { sales: '#5b21b6', operations: '#1e40af' };
const JOB_STATUSES = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
const DEFAULT_STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
// How far ahead an appointment starts fading in from pale to its full status colour
const FADE_WINDOW_HOURS = 120; // 5 days
const MAX_LIGHTEN = 0.72;

// Mix a hex colour toward white by `amt` (0 = unchanged, 1 = white)
function lightenHex(hex, amt) {
  const h = (hex || '#6b7280').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16) || 0x6b7280;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const mix = c => Math.round(c + (255 - c) * amt);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Combine a schedule row's date + optional start time into a real Date, for time-based fading
function apptDateTime(row) {
  const d = row.scheduled_date.split('T')[0];
  return new Date(`${d}T${row.start_time || '00:00'}:00`);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfWeekMon(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}
function shiftDate(date, view, dir) {
  const d = new Date(date);
  if (view === 'day') d.setDate(d.getDate() + dir);
  else if (view === 'timeGridWeek') d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  return d;
}
function formatTitle(view, date) {
  if (view === 'dayGridMonth') return date.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
  if (view === 'day') return date.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const start = startOfWeekMon(date);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const startStr = start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  const endStr = end.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

export default function SchedulePage() {
  const { user } = useAuth();
  const calRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [techMap, setTechMap] = useState({});
  const [techRoles, setTechRoles] = useState({});
  const [statusColours, setStatusColours] = useState(DEFAULT_STATUS_COLOURS);
  const [filterTech, setFilterTech] = useState('');
  const [filterApptType, setFilterApptType] = useState(''); // '' | 'sales' | 'operations'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  // Raw rows from the API — recomputed into fcEvents whenever filters, colours, or the clock changes
  const [rawSchedules, setRawSchedules] = useState([]);
  const [fcEvents, setFcEvents] = useState([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const viewKey = user ? `schedule_view_${user.id}` : 'schedule_view';
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem(viewKey);
    if (saved === 'timeGridDay' || saved === 'resourceTimeGridDay') return 'day';
    return saved || 'dayGridMonth';
  });
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Auto-open assign modal if ?job= param present
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (jobId) setAssignTarget({ jobId, date: new Date().toISOString().split('T')[0] });
  }, []);

  useEffect(() => {
    api.get('/users').then(r => {
      const map = {};
      const roles = {};
      r.data.forEach(u => { map[u.id] = u.name; roles[u.id] = u.role; });
      setTechMap(map);
      setTechRoles(roles);
    }).catch(() => {});
    api.get('/settings/job-status-colours').then(r => setStatusColours(r.data)).catch(() => {});
  }, []);

  // Refresh "now" periodically so upcoming appointments fade in as their time approaches
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Keep FullCalendar (Month/Week) in sync with our own toolbar's date/view state
  useEffect(() => {
    if (view === 'day') return;
    const api = calRef.current?.getApi();
    if (api) api.changeView(view, currentDate);
  }, [view, currentDate]);

  useEffect(() => { localStorage.setItem(viewKey, view); }, [view]);

  // Person colour — used only for the Day view column headers now that
  // appointments themselves are colour-coded by job status
  function techColour(userId, map) {
    const keys = Object.keys(map);
    const idx = keys.indexOf(userId);
    return TECH_COLOURS[idx >= 0 ? idx % TECH_COLOURS.length : 0];
  }

  // Colour an appointment by its job status — paler if it's still upcoming,
  // full brightness once its scheduled time has arrived or passed.
  function styleForAppt(row) {
    const base = statusColours[row.status] || DEFAULT_STATUS_COLOURS[row.status] || '#6b7280';
    const hoursUntil = (apptDateTime(row).getTime() - nowTick) / 3600000;
    const lightenAmt = hoursUntil <= 0 ? 0 : Math.min(1, hoursUntil / FADE_WINDOW_HOURS) * MAX_LIGHTEN;
    return {
      background: lightenHex(base, lightenAmt),
      border: base,
      text: lightenAmt > 0.4 ? '#1e293b' : '#ffffff',
    };
  }

  function loadSchedules() {
    api.get('/schedules').then(r => setRawSchedules(r.data)).catch(() => {});
  }

  useEffect(() => { loadSchedules(); }, []);

  // Recompute calendar events whenever the raw data, filters, status colours, or clock tick change
  useEffect(() => {
    const events = rawSchedules
      .filter(s => !filterTech || s.user_id === filterTech)
      .filter(s => !filterApptType || s.appointment_type === filterApptType)
      .map(s => {
        const d = s.scheduled_date.split('T')[0]; // strip Postgres timestamp
        const { background, border, text } = styleForAppt(s);
        return {
          id: `sched-${s.id}`,
          resourceId: s.user_id,
          dateKey: d,
          startTime: s.start_time,
          endTime: s.end_time,
          title: `${formatJobNumber(s)} ${s.customer_name || ''} — ${s.tech_name || ''}`,
          start: s.start_time ? `${d}T${s.start_time}` : d,
          end:   s.end_time   ? `${d}T${s.end_time}`   : undefined,
          allDay: !s.start_time,
          backgroundColor: background,
          borderColor: border,
          textColor: text,
          extendedProps: { ...s, schedId: s.id, type: 'scheduled' },
        };
      });
    setFcEvents(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSchedules, filterTech, filterApptType, statusColours, nowTick]);

  // Persist a change to one appointment's date/time/team member — shared by
  // FullCalendar's drag/resize (Month/Week) and the custom Day view's drag/resize
  async function saveApptChange(schedId, payload) {
    if (!schedId) return;
    try {
      await api.put(`/schedules/${schedId}`, payload);
      loadSchedules();
    } catch { loadSchedules(); }
  }

  async function handleFcEventDrop({ event, revert }) {
    const start = event.start;
    const payload = {
      scheduled_date: toDateStr(start),
      start_time: event.allDay ? null : `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
      end_time: event.allDay || !event.end ? null : `${pad2(event.end.getHours())}:${pad2(event.end.getMinutes())}`,
    };
    try {
      await api.put(`/schedules/${event.extendedProps.schedId}`, payload);
      loadSchedules();
    } catch { revert(); }
  }

  async function handleFcEventResize({ event, revert }) {
    const payload = {
      end_time: event.end ? `${pad2(event.end.getHours())}:${pad2(event.end.getMinutes())}` : null,
    };
    try {
      await api.put(`/schedules/${event.extendedProps.schedId}`, payload);
      loadSchedules();
    } catch { revert(); }
  }

  function handleEventClick({ event }) {
    setSelectedEvent(event.extendedProps);
    setNotesDraft(event.extendedProps.notes || '');
  }

  function openAssign(dateStr, resourceId) {
    if (user?.role === 'field_tech') return;
    setAssignTarget({
      date: dateStr,
      jobId: searchParams.get('job') || undefined,
      userId: resourceId,
    });
  }

  function handleFcDateClick({ dateStr }) {
    openAssign(dateStr.split('T')[0]);
  }

  async function handleSaveNotes() {
    if (!selectedEvent?.schedId) return;
    setSavingNotes(true);
    try {
      await api.put(`/schedules/${selectedEvent.schedId}`, { notes: notesDraft });
      setSelectedEvent(e => ({ ...e, notes: notesDraft }));
      loadSchedules();
    } finally { setSavingNotes(false); }
  }

  // One column per team member for the Day view — filtered to match the dropdown above
  const resources = Object.entries(techMap)
    .filter(([id]) => !filterTech || id === filterTech)
    .map(([id, name]) => ({ id, title: name }));

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
          <p className={styles.pageSubtitle}>Click a date to schedule a job · Drag or resize to adjust</p>
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

      <div className={styles.typeFilterRow}>
        <span className={styles.typeFilterLabel}>Show:</span>
        <div className={styles.typeFilterGroup}>
          <button
            className={`${styles.typeFilterBtn} ${!filterApptType ? styles.typeFilterBtnActive : ''}`}
            onClick={() => setFilterApptType('')}
          >All</button>
          {['sales', 'operations'].map(t => (
            <button
              key={t}
              className={`${styles.typeFilterBtn} ${filterApptType === t ? styles.typeFilterBtnActive : ''}`}
              style={filterApptType === t ? { borderColor: APPT_TYPE_COLOURS[t], color: APPT_TYPE_COLOURS[t], background: APPT_TYPE_COLOURS[t] + '12' } : {}}
              onClick={() => setFilterApptType(t)}
            >{APPT_TYPE_LABEL[t]}</button>
          ))}
        </div>
      </div>

      <div className={styles.legend}>
        {JOB_STATUSES.map(s => (
          <div key={s} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: statusColours[s] || DEFAULT_STATUS_COLOURS[s] }} />
            <span style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</span>
          </div>
        ))}
        <span className={styles.legendHint}>Paler = upcoming · Full colour = underway or past</span>
      </div>

      {/* Custom toolbar drives both FullCalendar (Month/Week) and the custom Day view */}
      <div className={styles.calToolbar}>
        <div className={styles.calToolbarNav}>
          <button className={styles.calNavBtn} onClick={() => setCurrentDate(d => shiftDate(d, view, -1))}>‹</button>
          <button className={styles.calNavBtn} onClick={() => setCurrentDate(d => shiftDate(d, view, 1))}>›</button>
          <button className={styles.calTodayBtn} onClick={() => setCurrentDate(new Date())}>Today</button>
        </div>
        <div className={styles.calToolbarTitle}>{formatTitle(view, currentDate)}</div>
        <div className={styles.calToolbarViews}>
          {[['dayGridMonth', 'Month'], ['timeGridWeek', 'Week'], ['day', 'Day']].map(([v, label]) => (
            <button key={v} className={`${styles.calViewBtn} ${view === v ? styles.calViewBtnActive : ''}`}
              onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
      </div>

      <div className={styles.calendarWrap}>
        <div style={{ display: view === 'day' ? 'none' : 'block', height: '100%' }}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={view === 'day' ? 'dayGridMonth' : view}
            initialDate={currentDate}
            headerToolbar={false}
            height="100%"
            expandRows
            editable={canEdit}
            droppable={canEdit}
            eventDrop={handleFcEventDrop}
            eventResize={handleFcEventResize}
            eventClick={handleEventClick}
            dateClick={handleFcDateClick}
            events={fcEvents}
            eventDisplay="block"
            dayMaxEvents={4}
            slotMinTime="07:00:00"
            slotMaxTime="20:30:00"
            nowIndicator
            firstDay={1}
            locale="en-NZ"
            eventDidMount={({ el, event }) => { el.title = event.title; }}
          />
        </div>
        {view === 'day' && (
          <DayColumnsView
            date={currentDate}
            events={fcEvents}
            resources={resources}
            techColour={id => techColour(id, techMap)}
            canEdit={canEdit}
            onEventClick={props => { setSelectedEvent(props); setNotesDraft(props.notes || ''); }}
            onSlotClick={(dateStr, resourceId) => openAssign(dateStr, resourceId)}
            onSaveMove={saveApptChange}
          />
        )}
      </div>

      {selectedEvent && (
        <div className={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Job {formatJobNumber(selectedEvent)}</h2>
              <button className={styles.modalClose} onClick={() => setSelectedEvent(null)}>✕</button>
            </div>
            <div className={styles.eventDetails}>
              <div className={styles.eventRow}><span>Customer</span><strong>{selectedEvent.customer_name || '—'}</strong></div>
              <div className={styles.eventRow}><span>Type</span><strong>{selectedEvent.job_type?.replace('_',' ')}</strong></div>
              {selectedEvent.tech_name && <div className={styles.eventRow}><span>Team Member</span><strong>{selectedEvent.tech_name}</strong></div>}
              {selectedEvent.appointment_type && (
                <div className={styles.eventRow}><span>Appointment Type</span>
                  <strong style={{ color: APPT_TYPE_COLOURS[selectedEvent.appointment_type] }}>
                    {APPT_TYPE_LABEL[selectedEvent.appointment_type]}
                  </strong>
                </div>
              )}
              <div className={styles.eventRow}><span>Date</span><strong>{new Date(selectedEvent.scheduled_date).toLocaleDateString('en-NZ')}</strong></div>
              {selectedEvent.start_time && <div className={styles.eventRow}><span>Time</span><strong>{selectedEvent.start_time}{selectedEvent.end_time ? ` – ${selectedEvent.end_time}` : ''}</strong></div>}
              {selectedEvent.description && <div className={styles.eventRow}><span>Job Description</span><strong>{selectedEvent.description}</strong></div>}
              <div className={styles.eventRow}><span>Status</span>
                <strong style={{ textTransform:'capitalize', color: statusColours[selectedEvent.status] || DEFAULT_STATUS_COLOURS[selectedEvent.status] }}>
                  {selectedEvent.status?.replace('_',' ')}
                </strong>
              </div>
            </div>

            <div className={styles.notesSection}>
              <label>Appointment Notes</label>
              {canEdit ? (
                <>
                  <textarea rows={3} value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                    placeholder="Notes specific to this appointment (separate from the job's own notes)…" />
                  {notesDraft !== (selectedEvent.notes || '') && (
                    <button className={styles.btnSecondary} onClick={handleSaveNotes} disabled={savingNotes}>
                      {savingNotes ? 'Saving…' : 'Save Notes'}
                    </button>
                  )}
                </>
              ) : (
                <p className={styles.notesReadonly}>{selectedEvent.notes || 'No notes for this appointment.'}</p>
              )}
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
          userId={assignTarget.userId}
          techMap={techMap}
          techRoles={techRoles}
          onClose={() => setAssignTarget(null)}
          onAssigned={handleAssigned}
        />
      )}
    </div>
  );
}
