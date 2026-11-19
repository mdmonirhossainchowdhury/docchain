import { useEffect } from "react";

export const CATEGORIES = [
  { id: "prescription", label: "Prescription", icon: "💊" },
  { id: "lab_report", label: "Lab report", icon: "🧪" },
  { id: "xray", label: "X-ray", icon: "🩻" },
  { id: "scan", label: "MRI / CT / Ultrasound", icon: "🧲" },
  { id: "discharge", label: "Discharge summary", icon: "🏥" },
  { id: "vaccination", label: "Vaccination", icon: "💉" },
  { id: "insurance", label: "Insurance / bill", icon: "🧾" },
  { id: "other", label: "Other", icon: "📄" },
];
export const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

export const NOTE_KINDS = [
  { id: "doctor_advice", label: "Doctor's advice", icon: "🩺" },
  { id: "note", label: "Note", icon: "📝" },
  { id: "tip", label: "Health tip", icon: "💡" },
  { id: "symptom", label: "Symptom", icon: "🌡️" },
  { id: "medication", label: "Medication", icon: "💊" },
  { id: "vitals", label: "Vitals", icon: "❤️" },
  { id: "question", label: "Question for doctor", icon: "❓" },
];
export const kindOf = (id) => NOTE_KINDS.find((k) => k.id === id) || NOTE_KINDS[1];

export const STAGES = [
  { id: "screening", label: "Screening", hint: "Test or check-up planned/done" },
  { id: "flagged", label: "Flagged", hint: "Result needs attention" },
  { id: "referred", label: "Referred", hint: "Sent to a specialist/clinic" },
  { id: "follow_up", label: "Follow-up", hint: "Treatment or repeat visit" },
  { id: "completed", label: "Care received", hint: "Loop closed" },
];

export const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
export const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const Spinner = ({ label }) => (
  <div className="spinner-wrap">
    <span className="spinner" /> {label}
  </div>
);

export const Empty = ({ icon = "📭", title, children }) => (
  <div className="empty">
    <div className="empty-icon">{icon}</div>
    <strong>{title}</strong>
    <p>{children}</p>
  </div>
);
