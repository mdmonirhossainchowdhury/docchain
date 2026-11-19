import { useCallback, useEffect, useRef, useState } from "react";
import { api, printBlob, saveBlob } from "../api";
import { useApp } from "../state";
import { CATEGORIES, Empty, Modal, Spinner, addDaysISO, catOf, fmtDate, fmtSize } from "../ui";

export default function Records() {
  const { pid, user, viewing, notify } = useApp();
  const [docs, setDocs] = useState(null);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ category: "prescription", title: "", doc_date: "" });
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const input = useRef();

  const load = useCallback(async () => {
    try {
      setDocs(await api.docs(pid, q));
    } catch (e) {
      notify(e.message, "err");
      setDocs([]);
    }
  }, [pid, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  // poll while the AI is still reading new uploads
  useEffect(() => {
    if (!docs?.some((d) => d.ai_status === "pending")) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [docs, load]);

  const pick = (list) => setFiles(Array.from(list || []));

  const upload = async (e) => {
    e.preventDefault();
    if (!files.length) return notify("Choose a file first", "err");
    setUploading(true);
    let okCount = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("category", form.category);
      fd.append("title", files.length === 1 ? form.title : "");
      fd.append("doc_date", form.doc_date);
      try {
        await api.uploadDoc(pid, fd);
        okCount++;
      } catch (ex) {
        notify(`${f.name}: ${ex.message}`, "err");
      }
    }
    setUploading(false);
    if (okCount) notify(`${okCount} record${okCount > 1 ? "s" : ""} saved`);
    setFiles([]);
    setForm({ ...form, title: "", doc_date: "" });
    if (input.current) input.current.value = "";
    load();
  };

  const act = async (d, kind) => {
    try {
      const blob = await api.fileBlob(pid, d.id, kind === "download");
      if (kind === "download") saveBlob(blob, d.filename);
      else printBlob(blob);
    } catch (e) {
      notify(e.message, "err");
    }
  };

  const remove = async (d) => {
    if (!confirm(`Delete "${d.title}" permanently?`)) return;
    try {
      await api.deleteDoc(pid, d.id);
      notify("Record deleted");
      load();
    } catch (e) {
      notify(e.message, "err");
    }
  };

  const shown = (docs || []).filter((d) => cat === "all" || d.category === cat);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Medical records</h2>
          <p>Prescriptions, lab reports, X-rays and more. Preview, download or print any time.</p>
        </div>
      </div>

      <form className="card" onSubmit={upload}>
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => input.current.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files);
          }}
        >
          <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt" onChange={(e) => pick(e.target.files)} />
          {files.length ? (
            <strong>{files.map((f) => f.name).join(", ")}</strong>
          ) : (
            <>
              <strong>Drop files here or click to choose</strong>
              <p className="hint" style={{ margin: 0 }}>PDF, PNG, JPG, WEBP, GIF or TXT · up to 25 MB each</p>
            </>
          )}
        </div>
        <div className="row3" style={{ marginTop: 14 }}>
          <label>
            Type
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
              ))}
            </select>
          </label>
          <label>
            Title <small>(optional)</small>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={files.length > 1} placeholder="e.g. Blood test – Nov 2026" />
          </label>
          <label>
            Document date
            <input type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} />
          </label>
        </div>
        <button className="btn primary" disabled={uploading || !files.length}>
          {uploading ? "Uploading…" : viewing ? "Add to patient's records" : "Save to my records"}
        </button>
      </form>

      <div className="card">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <input style={{ maxWidth: 320 }} placeholder="🔍 Search title or contents…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filters">
          <button className={cat === "all" ? "on" : ""} onClick={() => setCat("all")}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        {docs === null ? (
          <Spinner label="Loading records…" />
        ) : shown.length === 0 ? (
          <Empty icon="🗂️" title="No records found">
            {docs.length ? "Try another filter or search." : "Upload your first document above."}
          </Empty>
        ) : (
          <div className="doc-list">
            {shown.map((d) => (
              <div className="doc" key={d.id}>
                <div className="doc-icon">{catOf(d.category).icon}</div>
                <div className="doc-main">
                  <strong title={d.title}>{d.title}</strong>
                  <small>
                    {catOf(d.category).label} · {fmtDate(d.doc_date || d.created_at)} · {fmtSize(d.size)}
                    {d.uploaded_by !== d.patient_id && ` · added by ${d.uploaded_by_name}`}
                  </small>
                  {d.ai_status === "pending" && <p><span className="chip grey">⏳ AI is reading this…</span></p>}
                  {d.ai_summary && <p>{d.ai_summary}</p>}
                </div>
                <div className="doc-actions">
                  <button className="btn small primary" onClick={() => setPreview(d)}>Preview</button>
                  <button className="btn small" onClick={() => act(d, "download")}>⬇ Download</button>
                  <button className="btn small" onClick={() => act(d, "print")}>🖨 Print</button>
                  {pid === user.id && <button className="btn small danger" onClick={() => remove(d)}>Delete</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && <Preview doc={preview} onClose={() => setPreview(null)} onChanged={load} />}
    </>
  );
}

function Preview({ doc, onClose, onChanged }) {
  const { pid, notify } = useApp();
  const [url, setUrl] = useState(null);
  const [detail, setDetail] = useState(null);
  const [added, setAdded] = useState({});

  useEffect(() => {
    let revoke;
    api
      .fileBlob(pid, doc.id)
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch((e) => notify(e.message, "err"));
    return () => revoke && URL.revokeObjectURL(revoke);
  }, [doc.id]);

  useEffect(() => {
    let alive = true,
      t;
    const poll = async () => {
      try {
        const d = await api.doc(pid, doc.id);
        if (!alive) return;
        setDetail(d);
        if (d.ai_status === "pending") t = setTimeout(poll, 3500);
        else onChanged();
      } catch {}
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [doc.id]);

  const ai = detail?.ai;
  const addFollow = async (f, i) => {
    try {
      await api.addTask(pid, {
        title: f.title,
        details: `${f.details || ""}\n(From: ${doc.title})`.trim(),
        due_date: f.due_in_days != null ? addDaysISO(f.due_in_days) : "",
        stage: "follow_up",
        source: "ai",
      });
      setAdded({ ...added, [i]: true });
      notify("Added to Care Loop");
    } catch (e) {
      notify(e.message, "err");
    }
  };

  const isImg = doc.mime.startsWith("image/");
  return (
    <Modal title={doc.title} onClose={onClose} wide>
      <div className="preview">
        <div className="viewer">{!url ? <Spinner label="Loading…" /> : isImg ? <img src={url} alt={doc.title} /> : <iframe src={url} title={doc.title} />}</div>
        <div className="ai-panel">
          <h3>AI reading</h3>
          {!detail || detail.ai_status === "pending" ? (
            <Spinner label="Analysing document…" />
          ) : !ai ? (
            <p className="hint">{detail.ai_status === "failed" ? "The AI could not read this document." : "AI analysis is off. Add ANTHROPIC_API_KEY in backend/.env to enable it."}</p>
          ) : (
            <>
              <p>{ai.summary}</p>
              {ai.red_flags?.length > 0 && (
                <>
                  <h4>⚠️ Needs attention</h4>
                  <ul>{ai.red_flags.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {ai.abnormal_values?.length > 0 && (
                <>
                  <h4>Abnormal values</h4>
                  <ul>{ai.abnormal_values.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {ai.key_findings?.length > 0 && (
                <>
                  <h4>Key findings</h4>
                  <ul>{ai.key_findings.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {ai.medications?.length > 0 && (
                <>
                  <h4>Medicines</h4>
                  <ul>{ai.medications.map((m, i) => <li key={i}>{[m.name, m.dose, m.instructions].filter(Boolean).join(" · ")}</li>)}</ul>
                </>
              )}
              {ai.follow_up?.length > 0 && (
                <>
                  <h4>Suggested follow-up</h4>
                  {ai.follow_up.map((f, i) => (
                    <div className="suggest" key={i}>
                      <div>
                        <strong>{f.title}</strong>
                        <p className="hint" style={{ margin: 0 }}>{f.details}</p>
                      </div>
                      <button className="btn small primary" disabled={added[i]} onClick={() => addFollow(f, i)}>
                        {added[i] ? "Added ✓" : "+ Care Loop"}
                      </button>
                    </div>
                  ))}
                </>
              )}
              <p className="hint" style={{ marginTop: 12 }}>AI can make mistakes. Always check the original document and ask your doctor.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
