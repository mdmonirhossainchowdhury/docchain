import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import { useApp } from "../state";
import { Empty, Spinner, catOf, fmtDate } from "../ui";

const TL_ICON = { document: "🗂️", note: "📝", task: "🔁" };

export default function Dashboard() {
  const { pid, user, viewing, notify } = useApp();
  const [sum, setSum] = useState(null);
  const [snap, setSnap] = useState({ loading: true });

  const loadSnap = (force = false) => {
    setSnap({ loading: true });
    api
      .snapshot(pid, force)
      .then((s) => setSnap(s))
      .catch(() => setSnap({ text: null }));
  };

  useEffect(() => {
    let alive = true;
    setSum(null);
    api.summary(pid).then((s) => alive && setSum(s)).catch((e) => notify(e.message, "err"));
    setSnap({ loading: true });
    api.snapshot(pid).then((s) => alive && setSnap(s)).catch(() => alive && setSnap({ text: null }));
    return () => {
      alive = false;
    };
  }, [pid]);

  if (!sum) return <Spinner label="Loading your health history…" />;
  const c = sum.counts;
  const p = sum.profile;
  const maxCat = Math.max(1, ...Object.values(sum.by_category));
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{viewing ? p.name : `${greet}, ${user.name.split(" ")[0]}`}</h2>
          <p>
            {viewing ? "Patient overview" : "Here is your health history, built from your own documents."}
            {p.age != null && ` · ${p.age} yrs`}
            {p.gender && ` · ${p.gender}`}
            {p.blood_group && ` · ${p.blood_group}`}
          </p>
        </div>
        <Link className="btn primary" to="/records">
          + Upload record
        </Link>
      </div>

      {(p.allergies || p.conditions) && (
        <div className="card" style={{ marginBottom: 16 }}>
          {p.allergies && (
            <p>
              <span className="chip err">Allergies</span> {p.allergies}
            </p>
          )}
          {p.conditions && (
            <p style={{ margin: 0 }}>
              <span className="chip warn">Conditions</span> {p.conditions}
            </p>
          )}
        </div>
      )}

      <div className="grid stats">
        <div className="stat"><b>{c.documents}</b><span>Records</span></div>
        <div className="stat"><b>{c.notes}</b><span>Notes</span></div>
        <div className="stat"><b>{c.open_tasks}</b><span>Open follow-ups</span></div>
        <div className={`stat ${c.overdue ? "warn" : ""}`}><b>{c.overdue}</b><span>Overdue</span></div>
        <div className={`stat ${c.loop_rate >= 50 ? "good" : ""}`}><b>{c.loop_rate == null ? "–" : c.loop_rate + "%"}</b><span>Care loop closed</span></div>
      </div>

      <div className="card snapshot" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <h3>🤖 Health snapshot</h3>
          {snap.ai && !snap.loading && (
            <button className="btn small ghost" onClick={() => loadSnap(true)}>
              Refresh
            </button>
          )}
        </div>
        <p>{sum.text}</p>
        {snap.loading ? (
          <Spinner label="AI is reading your records…" />
        ) : snap.text ? (
          <div className="md">
            <ReactMarkdown>{snap.text}</ReactMarkdown>
          </div>
        ) : (
          <p className="hint">{snap.ai === false ? "Add an ANTHROPIC_API_KEY in backend/.env to get an AI-written snapshot." : "AI snapshot unavailable right now."}</p>
        )}
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Recent activity</h3>
          {sum.timeline.length === 0 ? (
            <Empty icon="🗂️" title="Nothing here yet">
              Upload your first prescription or report to start your timeline.
            </Empty>
          ) : (
            <ul className="timeline">
              {sum.timeline.map((t) => (
                <li key={t.type + t.id}>
                  <div className="tl-icon">{TL_ICON[t.type]}</div>
                  <div className="tl-main">
                    <strong>{t.title}</strong>
                    <small>{t.type === "document" ? catOf(t.sub).label : t.sub}</small>
                  </div>
                  <span className="tl-date">{fmtDate(t.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Records by type</h3>
          {Object.keys(sum.by_category).length === 0 && <p className="hint">No records yet.</p>}
          {Object.entries(sum.by_category).map(([k, v]) => (
            <div key={k}>
              <div className="catrow">
                <span>{catOf(k).icon} {catOf(k).label}</span>
                <b>{v}</b>
              </div>
              <div className="bar"><i style={{ width: `${(v / maxCat) * 100}%` }} /></div>
            </div>
          ))}
          <div style={{ marginTop: 18 }}>
            <Link className="btn small" to="/care">Open Care Loop →</Link>{" "}
            <Link className="btn small" to="/assistant">Ask AI →</Link>
          </div>
        </div>
      </div>
    </>
  );
}
