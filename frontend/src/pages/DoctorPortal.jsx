import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../state";
import { Spinner } from "../ui";

export default function DoctorPortal() {
  const { user, setViewing, viewing, notify } = useApp();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState(null);

  const load = () => api.doctorGrants().then(setRecent).catch(() => setRecent([]));
  useEffect(() => { load(); }, []);

  const open = (p) => {
    setViewing(p);
    nav("/");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.doctorAccess(code, pin);
      notify(`Access granted for ${r.expires_hours} hours`);
      open(r.patient);
    } catch (ex) {
      notify(ex.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const close = async (p) => {
    await api.doctorClose(p.id).catch(() => {});
    load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Doctor portal</h2>
          <p>Dr. {user.name}{user.specialty ? ` · ${user.specialty}` : ""}. Open a patient's history with their Patient ID and PIN.</p>
        </div>
        {viewing && <button className="btn" onClick={() => setViewing(null)}>Back to my own records</button>}
      </div>

      <div className="grid two">
        <form className="card" onSubmit={submit}>
          <h3>Open a patient</h3>
          <label>
            Patient ID
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DC-XXXXXX" required autoComplete="off" />
          </label>
          <label>
            Access PIN <small>(patient gives you this)</small>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6 digits" required autoComplete="off" />
          </label>
          <button className="btn primary block" disabled={busy || !code || pin.length !== 6}>{busy ? "Checking…" : "Open patient history"}</button>
          <p className="hint" style={{ marginTop: 12 }}>The patient is notified in their access log. You can read records, add notes, upload documents and add follow-ups. Only the patient can delete records.</p>
        </form>

        <div className="card">
          <h3>Patients you can access now</h3>
          {recent === null ? <Spinner /> : recent.length === 0 ? <p className="hint">No active patients. Access expires automatically after a few hours.</p> : recent.map((p) => (
            <div className="suggest" key={p.id} style={{ alignItems: "center" }}>
              <div>
                <strong>{p.name}</strong>
                <p className="hint" style={{ margin: 0 }}>{p.patient_code} · until {new Date(p.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <button className="btn small primary" onClick={() => open(p)}>Open</button>
              <button className="btn small" onClick={() => close(p)}>End</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
