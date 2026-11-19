import { useState } from "react";
import { useApp } from "../state";

export default function Auth() {
  const { login, register } = useApp();
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", email: "", password: "", is_doctor: false, specialty: "", license_no: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") await login(f.email, f.password);
      else await register(f);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand big">
          <span className="logo">+</span> DocChain
        </div>
        <h1>Your health records, always with you.</h1>
        <p>Screening is only useful if care follows. DocChain keeps every report in one place and tracks each result until you actually get the care you need.</p>
        <ul>
          <li>🗂️ Upload prescriptions, lab reports and X-rays once</li>
          <li>🔁 Care Loop turns flagged results into follow-ups</li>
          <li>🩺 Share with any doctor using your Patient ID + PIN</li>
          <li>🤖 Ask the AI assistant in English or বাংলা</li>
        </ul>
      </section>
      <section className="auth-card">
        <div className="tabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")} type="button">
            Log in
          </button>
          <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")} type="button">
            Create account
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <div className="seg">
                <button type="button" className={!f.is_doctor ? "on" : ""} onClick={() => setF({ ...f, is_doctor: false })}>
                  🙋 I'm a patient
                </button>
                <button type="button" className={f.is_doctor ? "on" : ""} onClick={() => setF({ ...f, is_doctor: true })}>
                  🩺 I'm a doctor
                </button>
              </div>
              {f.is_doctor && <p className="hint">Doctors also get their own patient account, so you can keep your personal records too.</p>}
              <label>
                Full name
                <input value={f.name} onChange={set("name")} required autoComplete="name" />
              </label>
            </>
          )}
          <label>
            Email
            <input type="email" value={f.email} onChange={set("email")} required autoComplete="email" />
          </label>
          <label>
            Password {mode === "register" && <small>(min 8 characters)</small>}
            <input type="password" value={f.password} onChange={set("password")} required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {mode === "register" && f.is_doctor && (
            <div className="row">
              <label>
                Specialty
                <input value={f.specialty} onChange={set("specialty")} placeholder="e.g. Cardiology" />
              </label>
              <label>
                License / BMDC no.
                <input value={f.license_no} onChange={set("license_no")} />
              </label>
            </div>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn primary block" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}
