import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";
import { Empty, NOTE_KINDS, Spinner, fmtDate, kindOf } from "../ui";

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export default function Notes() {
  const { pid, user, viewing, notify } = useApp();
  const [notes, setNotes] = useState(null);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ kind: viewing ? "doctor_advice" : "note", title: "", content: "" });
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("en-US");
  const rec = useRef(null);

  const load = () => api.notes(pid).then(setNotes).catch((e) => { notify(e.message, "err"); setNotes([]); });
  useEffect(() => { setNotes(null); load(); }, [pid]);
  useEffect(() => () => rec.current?.stop?.(), []);

  const toggleMic = () => {
    if (listening) return rec.current?.stop();
    const r = new SR();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      setForm((f) => ({ ...f, content: (f.content ? f.content.trimEnd() + " " : "") + text.trim() }));
    };
    r.onerror = () => notify("Could not use the microphone", "err");
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  const save = async (e) => {
    e.preventDefault();
    rec.current?.stop?.();
    setBusy(true);
    try {
      await api.addNote(pid, form);
      setForm({ ...form, title: "", content: "" });
      notify("Saved");
      load();
    } catch (ex) {
      notify(ex.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n) => {
    if (!confirm("Delete this note?")) return;
    try { await api.deleteNote(pid, n.id); load(); } catch (e) { notify(e.message, "err"); }
  };

  const shown = (notes || []).filter((n) => filter === "all" || n.kind === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Notes & advice</h2>
          <p>Record doctor's advice, symptoms, tips, medicines or anything you want to remember.</p>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <div className="row">
          <label>
            Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {NOTE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
            </select>
          </label>
          <label>
            Title <small>(optional)</small>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
          </label>
        </div>
        <label>
          Your note
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={viewing ? "Write advice or a clinical note for this patient…" : "e.g. Dr. Rahman said to take the tablet after meals and repeat the test in 3 months."} required />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn primary" disabled={busy || !form.content.trim()}>{busy ? "Saving…" : "Save note"}</button>
          {SR && (
            <>
              <button type="button" className={`btn ${listening ? "danger" : ""}`} onClick={toggleMic}>
                {listening ? "⏹ Stop dictation" : "🎙️ Dictate"}
              </button>
              <select style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening} aria-label="Dictation language">
                <option value="en-US">English</option>
                <option value="bn-BD">বাংলা</option>
              </select>
            </>
          )}
        </div>
      </form>

      <div className="card">
        <div className="filters">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
          {NOTE_KINDS.map((k) => (
            <button key={k.id} className={filter === k.id ? "on" : ""} onClick={() => setFilter(k.id)}>{k.icon} {k.label}</button>
          ))}
        </div>
        {notes === null ? <Spinner label="Loading notes…" /> : shown.length === 0 ? (
          <Empty icon="📝" title="No notes yet">Add your first note above.</Empty>
        ) : (
          <div className="doc-list">
            {shown.map((n) => (
              <div key={n.id} className={`note ${n.author_is_doctor ? "doctor" : ""}`}>
                <header>
                  <span>
                    <span className="chip">{kindOf(n.kind).icon} {kindOf(n.kind).label}</span>{" "}
                    {n.title && <strong>{n.title}</strong>}
                  </span>
                  <small>
                    {n.author_id === user.id ? "You" : n.author_is_doctor ? `Dr. ${n.author_name}` : n.author_name} · {fmtDate(n.created_at)}
                  </small>
                </header>
                <div className="note-body">{n.content}</div>
                {(n.author_id === user.id) && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn small danger" onClick={() => remove(n)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
