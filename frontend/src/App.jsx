import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useApp } from "./state";
import { Spinner } from "./ui";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import Notes from "./pages/Notes";
import CareLoop from "./pages/CareLoop";
import Assistant from "./pages/Assistant";
import Share from "./pages/Share";
import DoctorPortal from "./pages/DoctorPortal";
import Profile from "./pages/Profile";

function Shell() {
  const { user, logout, viewing, setViewing } = useApp();
  const nav = useNavigate();
  const items = [
    ["/", "🏠", "Overview", true],
    ["/records", "🗂️", "Records"],
    ["/notes", "📝", "Notes"],
    ["/care", "🔁", "Care Loop"],
    ["/assistant", "🤖", "AI Assistant"],
  ];
  if (!viewing) items.push(["/share", "🔐", "Share & Access"]);
  if (user.is_doctor) items.push(["/doctor", "🩺", "Doctor Portal"]);
  items.push(["/profile", "👤", "Profile"]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">+</span> DocChain
        </div>
        <nav>
          {items.map(([to, icon, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span>{icon}</span> {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <div className="avatar">{user.name[0]?.toUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.is_doctor ? "Doctor + patient" : "Patient"} · {user.patient_code}</small>
            </div>
          </div>
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        {viewing && (
          <div className="banner">
            <span>
              🩺 You are viewing <strong>{viewing.name}</strong> ({viewing.patient_code}). Everything you add is attributed to you and logged for the patient.
            </span>
            <button
              className="btn small"
              onClick={() => {
                setViewing(null);
                nav("/doctor");
              }}
            >
              Close patient
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/records" element={<Records />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/care" element={<CareLoop />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/share" element={viewing ? <Navigate to="/" /> : <Share />} />
          <Route path="/doctor" element={user.is_doctor ? <DoctorPortal /> : <Navigate to="/" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useApp();
  if (loading) return <Spinner label="Loading DocChain…" />;
  return user ? <Shell /> : <Auth />;
}
