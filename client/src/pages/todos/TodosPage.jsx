import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Todos.module.css';

// New to-dos default to the logged-in user — assigning to yourself is the
// common case, and the field is required either way.
const emptyForm = userId => ({ description: '', notes: '', due_date: '', assigned_to: userId || '' });

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmtDate = d => new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric',
});

// Dated items are "due" the moment the date arrives; undated ones never are.
function dueState(todo) {
  if (!todo.due_date) return null;
  const due = todo.due_date.slice(0, 10);
  const today = todayStr();
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

const announceChange = () => window.dispatchEvent(new Event('todos-updated'));

export default function TodosPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('todo');
  const [todos, setTodos] = useState([]);
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(() => emptyForm(user?.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/todos?done=${tab === 'done'}`)
      .then(r => setTodos(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // Counts for the tab headers — the inactive tab's count still has to be right
  const refreshCounts = useCallback(() => {
    api.get('/todos?done=true').then(r => setDoneCount(r.data.length)).catch(() => {});
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts, todos]);

  useEffect(() => {
    api.get('/users').then(r => setStaff(r.data.filter(u => u.is_active !== false))).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!form.description.trim()) { setError('Description is required'); return; }
    if (!form.assigned_to) { setError('Please choose who this is assigned to'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        description: form.description.trim(),
        notes: form.notes || null,
        due_date: form.due_date || null,
        assigned_to: form.assigned_to,
      };
      if (editing) await api.put(`/todos/${editing}`, payload);
      else await api.post('/todos', payload);
      setForm(emptyForm(user?.id)); setShowNew(false); setEditing(null);
      load(); announceChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  }

  async function toggleDone(todo) {
    try {
      await api.patch(`/todos/${todo.id}/done`, { done: !todo.done });
      load(); announceChange();
    } catch { alert('Could not update'); }
  }

  async function remove(id) {
    if (!confirm('Delete this to-do?')) return;
    try { await api.delete(`/todos/${id}`); load(); announceChange(); }
    catch { alert('Delete failed'); }
  }

  function startEdit(todo) {
    setEditing(todo.id);
    setForm({
      description: todo.description,
      notes: todo.notes || '',
      due_date: todo.due_date ? todo.due_date.slice(0, 10) : '',
      assigned_to: todo.assigned_to || '',
    });
    setShowNew(true);
  }

  function cancelForm() {
    setShowNew(false); setEditing(null); setForm(emptyForm(user?.id)); setError('');
  }

  const openCount = tab === 'todo' ? todos.length : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>To-Do List</h1>
        {!showNew && (
          <button className={styles.btnNew} onClick={() => setShowNew(true)}>+ New To-Do</button>
        )}
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'todo' ? styles.tabActive : ''}`}
          onClick={() => setTab('todo')}
        >
          To-Do {openCount != null && <span className={styles.tabCount}>{openCount}</span>}
        </button>
        <button
          className={`${styles.tab} ${tab === 'done' ? styles.tabActive : ''}`}
          onClick={() => setTab('done')}
        >
          Done <span className={styles.tabCount}>{doneCount}</span>
        </button>
      </div>

      {showNew && (
        <form className={styles.form} onSubmit={save}>
          <div className={styles.formTitle}>{editing ? 'Edit To-Do' : 'New To-Do'}</div>

          <label className={styles.label}>Description</label>
          <input
            className={styles.input}
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="What needs doing?"
            autoFocus
          />

          <label className={styles.label}>Notes (optional)</label>
          <textarea
            className={styles.textarea}
            value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            rows={2}
            placeholder="Any extra detail…"
          />

          <div className={styles.formRow}>
            <div className={styles.formCol}>
              <label className={styles.label}>Due date (optional)</label>
              <input
                type="date"
                className={styles.input}
                value={form.due_date}
                onChange={e => setField('due_date', e.target.value)}
              />
              <div className={styles.hint}>
                Leave blank to keep it as a reminder with no set date.
              </div>
            </div>
            <div className={styles.formCol}>
              <label className={styles.label}>Assign to</label>
              <select
                className={styles.input}
                value={form.assigned_to}
                onChange={e => setField('assigned_to', e.target.value)}
              >
                <option value="" disabled>Select a team member…</option>
                {staff.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.id === user?.id ? ' (me)' : ''}
                  </option>
                ))}
              </select>
              <div className={styles.hint}>
                Only you and the person assigned can see this to-do.
              </div>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.formButtons}>
            <button type="submit" className={styles.btnSave} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add To-Do'}
            </button>
            <button type="button" className={styles.btnCancel} onClick={cancelForm}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : todos.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{tab === 'todo' ? '✓' : '—'}</div>
          <div>{tab === 'todo' ? 'Nothing on the list' : 'Nothing completed yet'}</div>
        </div>
      ) : (
        <div className={styles.list}>
          {todos.map(todo => {
            const state = dueState(todo);
            return (
              <div key={todo.id} className={`${styles.row} ${todo.done ? styles.rowDone : ''}`}>
                <button
                  className={`${styles.check} ${todo.done ? styles.checkDone : ''}`}
                  onClick={() => toggleDone(todo)}
                  title={todo.done ? 'Mark as not done' : 'Mark as done'}
                >
                  {todo.done ? '✓' : ''}
                </button>

                <div className={styles.rowBody}>
                  <div className={styles.rowDesc}>{todo.description}</div>
                  {todo.notes && <div className={styles.rowNotes}>{todo.notes}</div>}
                  <div className={styles.rowMeta}>
                    {todo.due_date ? (
                      <span className={`${styles.due} ${styles[`due_${state}`]}`}>
                        {state === 'overdue' && 'Overdue · '}
                        {state === 'today' && 'Due today · '}
                        {fmtDate(todo.due_date)}
                      </span>
                    ) : (
                      <span className={styles.noDue}>Reminder — no date</span>
                    )}
                    {todo.assigned_to_name && (
                      <span className={styles.assignee}>{todo.assigned_to_name}</span>
                    )}
                    {todo.done && todo.done_at && (
                      <span className={styles.doneAt}>Done {fmtDate(todo.done_at)}</span>
                    )}
                  </div>
                </div>

                <div className={styles.rowActions}>
                  {!todo.done && (
                    <button className={styles.btnEdit} onClick={() => startEdit(todo)}>Edit</button>
                  )}
                  <button className={styles.btnDelete} onClick={() => remove(todo.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
