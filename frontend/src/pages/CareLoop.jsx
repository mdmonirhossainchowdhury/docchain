import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import { STAGES, Spinner, fmtDate } from "../ui";

const SRC = { doctor: "🩺 Doctor", ai: "🤖 AI", self: "You" };

export default function CareLoop() {
  const { pid, viewing, notify } = useApp();
  const [tasks, setTasks] = useState(null);
  const [form, setForm] = useState({ title: "", details: "", due_date: "", stage: "screening" });
  const [sugg, setSugg] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [show, setShow] = useState(false);

  const load = () => api.tasks(pid).then(setTasks).catch((e) => { notify(e.message, "err"); setTasks([]); });
  useEffect(() => { setTasks(null); setSugg(null); load(); }, [pid]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.addTask(pid, form);
      setForm({ title: "", details: "", due_date: "", stage: "screening" });
      setShow(false);
      load();
    } catch (ex) { notify(ex.message, "err"); }
  };

  const move = async (t, dir) => {
    const i = STAGES.findIndex((s) => s.id === t.stage) + dir;
    if (i < 0 || i >= STAGES.length) return;
    try {
      await api.patchTask(pid, t.id, { stage: STAGES[i].id });
      if (STAGES[i].id === "completed") notify("Loop closed. Nice work! 🎉");
      load();
    } catch (e) { notify(e.message, "err"); }
  };

  const remove = async (t) => {
    if (!confirm("Remove this item?")) return;
    try { await api.deleteTask(pid, t.id); load(); } catch (e) { notify(e.message, "err"); }
  };

  const suggest = async () => {
    setLoadingAI(true);
    try {
      const r = await api.followups(pid);
      if (!r.ai) notify("Add ANTHROPIC_API_KEY in backend/.env to enable AI suggestions", "err");
      else if (r.error) notify(r.error, "err");
      else if (!r.suggestions.length) notify("No new follow-ups found in the records");
      setSugg(r.suggestions || []);
    } catch (e) { notify(e.message, "err"); }
    setLoadingAI(false);
  };

  const accept = async (s, i) => {
    try {
      await api.addTask(pid, { ...s, source: "ai" });
      setSugg(sugg.filter((_, j) => j !== i));
      load();
    } catch (e) { notify(e.message, "err"); }
  };

  if (!tasks) return <Spinner label="Loading care loop…" />;
  const open = tasks.filter((t) => t.stage !== "completed");
  const overdue = tasks.filter((t) => t.overdue);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Care Loop</h2>
          <p>A screening only helps if care follows. Track every result until you've actually received care.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={suggest} disabled={loadingAI}>{loadingAI ? "Thinking…" : "🤖 Suggest from records"}</button>
          <button className="btn primary" onClick={() => setShow(!show)}>+ Add item</button>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="error">⚠️ {overdue.length} follow-up{overdue.length > 1 ? "s are" : " is"} overdue: {overdue.map((t) => t.title).join(", ")}</div>
      )}

      {show && (
        <form className="card" onSubmit={add} style={{ marginBottom: 16 }}>
          <div className="row">
            <label>What needs to happen?<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Repeat HbA1c test" maxLength={200} /></label>
            <label>Due date<input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          </div>
          <div className="row">
            <label>Details<input value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Where, with whom, why" /></label>
            <label>Stage<select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          </div>
          <button className="btn primary">Add to loop</button>
        </form>
      )}

      {sugg && sugg.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>🤖 Suggested from {viewing ? "this patient's" : "your"} records</h3>
          {sugg.map((s, i) => (
            <div className="suggest" key={i}>
              <div>
                <strong>{s.title}</strong>
                <p className="hint" style={{ margin: 0 }}>{s.details} {s.due_date && `· due ${fmtDate(s.due_date)}`}</p>
              </div>
              <button className="btn small primary" onClick={() => accept(s, i)}>Add</button>
              <button className="btn small" onClick={() => setSugg(sugg.filter((_, j) => j !== i))}>Dismiss</button>
            </div>
          ))}
        </div>
      )}

      <p className="hint">{open.length} open · {tasks.length - open.length} completed</p>
      <div className="board">
        {STAGES.map((s) => {
          const list = tasks.filter((t) => t.stage === s.id);
          return (
            <div className="col" key={s.id}>
              <h4>{s.label} <span>{list.length}</span></h4>
              <small>{s.hint}</small>
              {list.map((t) => (
                <div key={t.id} className={`task ${t.overdue ? "overdue" : ""}`}>
                  <strong>{t.title}</strong>
                  {t.details && <p>{t.details}</p>}
                  <div>
                    {t.due_date && <span className={`chip ${t.overdue ? "err" : "grey"}`}>{t.overdue ? "Overdue · " : "Due "}{fmtDate(t.due_date)}</span>}{" "}
                    <span className="chip grey">{SRC[t.source] || t.source}</span>
                  </div>
                  <div className="task-foot">
                    {s.id !== STAGES[0].id && <button onClick={() => move(t, -1)} aria-label="Move back">←</button>}
                    {s.id !== "completed" && <button onClick={() => move(t, 1)}>Next stage →</button>}
                    <button onClick={() => remove(t)} aria-label="Remove">✕</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
