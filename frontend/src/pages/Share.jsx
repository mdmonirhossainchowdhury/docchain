import { useEffect, useState } from "react";
import { api, saveBlob } from "../api";
import { useApp } from "../state";
import { Spinner, fmtDate } from "../ui";

const LABEL = {
  access_granted: "Doctor opened your records",
  viewed_summary: "Viewed your overview",
  viewed_document: "Viewed a document",
  downloaded_document: "Downloaded a document",
  uploaded_document: "Added a document",
  added_note: "Added a note",
  added_followup: "Added a follow-up",
  pin_rotated: "You changed your PIN",
  access_revoked: "You ended all doctor access",
};

export default function Share() {
  const { user, setUser, notify } = useApp();
  const [audit, setAudit] = useState(null);
  const [show, setShow] = useState(false);

  const load = () => api.myAudit().then(setAudit).catch((e) => notify(e.message, "err"));
  useEffect(() => { load(); }, []);

  const copy = (t) => navigator.clipboard?.writeText(t).then(() => notify("Copied"), () => notify("Copy failed", "err"));

  const rotate = async () => {
    if (!confirm("Create a new PIN? The old PIN will stop working.")) return;
    try {
      const r = await api.rotatePin();
      setUser({ ...user, access_pin: r.access_pin });
      notify("New PIN created");
      load();
    } catch (e) { notify(e.message, "err"); }
  };
  const revoke = async () => {
    if (!confirm("End access for all doctors right now?")) return;
    try { await api.revokeAll(); notify("All doctor access ended"); load(); } catch (e) { notify(e.message, "err"); }
  };
  const exportAll = async () => {
    try { saveBlob(await api.exportAll(user.id), "docchain-export.zip"); } catch (e) { notify(e.message, "err"); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Share & access</h2>
          <p>You decide who sees your history. Give a doctor your Patient ID and PIN to let them in.</p>
        </div>
      </div>

      <div className="card">
        <h3>Your sharing details</h3>
        <div className="row">
          <div>
            <small className="hint">Patient ID</small><br />
            <span className="idbox">{user.patient_code}</span>{" "}
            <button className="btn small" onClick={() => copy(user.patient_code)}>Copy</button>
          </div>
          <div>
            <small className="hint">Access PIN</small><br />
            <span className="idbox">{show ? user.access_pin : "••••••"}</span>{" "}
            <button className="btn small" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>{" "}
            {show && <button className="btn small" onClick={() => copy(user.access_pin)}>Copy</button>}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          A doctor needs <b>both</b> to open your records, and access lasts a few hours. Every view is logged below. Change your PIN after sharing if you like.
        </p>
        <button className="btn" onClick={rotate}>🔄 Create new PIN</button>{" "}
        <button className="btn danger" onClick={revoke}>⛔ End all doctor access</button>
      </div>

      <div className="card">
        <h3>Doctors with access right now</h3>
        {!audit ? <Spinner /> : audit.active.length === 0 ? <p className="hint">No doctor currently has access.</p> : (
          <table>
            <thead><tr><th>Doctor</th><th>Specialty</th><th>Access until</th></tr></thead>
            <tbody>{audit.active.map((g) => <tr key={g.id}><td>Dr. {g.doctor_name}</td><td>{g.specialty || "–"}</td><td>{new Date(g.expires_at).toLocaleString()}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Access log</h3>
        {!audit ? <Spinner /> : audit.log.length === 0 ? <p className="hint">Nothing yet.</p> : (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
            <tbody>
              {audit.log.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.actor_name}</td>
                  <td>{LABEL[a.action] || a.action}{a.detail && a.action !== "access_granted" ? ` · ${a.detail}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Take your data with you</h3>
        <p className="hint">Download every record, note and care-loop item as one ZIP file.</p>
        <button className="btn" onClick={exportAll}>⬇ Export everything</button>
      </div>
    </>
  );
}
