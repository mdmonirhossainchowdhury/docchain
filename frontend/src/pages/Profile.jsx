import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../state";

const FIELDS = ["name", "dob", "gender", "blood_group", "phone", "allergies", "conditions", "specialty", "license_no"];

export default function Profile() {
  const { user, setUser, viewing, setViewing, notify } = useApp();
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, user[k] || ""])));
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api.health().then(setHealth).catch(() => {}); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setUser(await api.updateMe(f));
      notify("Profile saved");
    } catch (ex) {
      notify(ex.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>My profile</h2>
          <p>{viewing ? "This is your own profile (not the patient's)." : "This info helps doctors and the AI give better guidance."}</p>
        </div>
        {viewing && <button className="btn" onClick={() => setViewing(null)}>Back to my records</button>}
      </div>
      <form className="card" onSubmit={save}>
        <div className="row">
          <label>Full name<input value={f.name} onChange={set("name")} required /></label>
          <label>Email<input value={user.email} disabled /></label>
        </div>
        <div className="row3">
          <label>Date of birth<input type="date" value={f.dob} onChange={set("dob")} /></label>
          <label>Gender
            <select value={f.gender} onChange={set("gender")}>
              <option value="">–</option><option>Female</option><option>Male</option><option>Other</option>
            </select>
          </label>
          <label>Blood group
            <select value={f.blood_group} onChange={set("blood_group")}>
              <option value="">–</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
        </div>
        <label>Phone<input value={f.phone} onChange={set("phone")} /></label>
        <label>Allergies<textarea style={{ minHeight: 60 }} value={f.allergies} onChange={set("allergies")} placeholder="e.g. Penicillin, peanuts" /></label>
        <label>Ongoing conditions<textarea style={{ minHeight: 60 }} value={f.conditions} onChange={set("conditions")} placeholder="e.g. Type 2 diabetes, hypertension" /></label>
        {user.is_doctor && (
          <div className="row">
            <label>Specialty<input value={f.specialty} onChange={set("specialty")} /></label>
            <label>License / BMDC no.<input value={f.license_no} onChange={set("license_no")} /></label>
          </div>
        )}
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
      {health && (
        <p className="hint" style={{ marginTop: 12 }}>
          AI status: {health.ai ? `connected (${health.model})` : "offline mode (no API key set)"}
        </p>
      )}
    </>
  );
}
