const BASE = import.meta.env.VITE_API_URL || "/api";

export const getToken = () => localStorage.getItem("dc_token");
export const setToken = (t) => (t ? localStorage.setItem("dc_token", t) : localStorage.removeItem("dc_token"));

async function req(path, { method = "GET", body, form, blob } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload });
  } catch {
    throw new Error("Cannot reach the server. Is the backend running?");
  }
  if (res.status === 401 && t) {
    setToken(null);
    window.dispatchEvent(new Event("dc-logout"));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d) => d.msg).join(", ") : msg;
    } catch {}
    throw new Error(msg);
  }
  return blob ? res.blob() : res.json();
}

const p = (pid) => `/patients/${pid}`;

export const api = {
  health: () => req("/health"),
  login: (email, password) => req("/auth/login", { method: "POST", body: { email, password } }),
  register: (data) => req("/auth/register", { method: "POST", body: data }),
  me: () => req("/me"),
  updateMe: (data) => req("/me", { method: "PUT", body: data }),
  rotatePin: () => req("/me/rotate-pin", { method: "POST" }),
  revokeAll: () => req("/me/grants", { method: "DELETE" }),
  myAudit: () => req("/me/audit"),

  doctorAccess: (patient_code, pin) => req("/doctor/access", { method: "POST", body: { patient_code, pin } }),
  doctorGrants: () => req("/doctor/grants"),
  doctorClose: (pid) => req(`/doctor/grants/${pid}`, { method: "DELETE" }),

  summary: (pid) => req(`${p(pid)}/summary`),
  snapshot: (pid, force = false) => req(`${p(pid)}/ai/snapshot?force=${force}`, { method: "POST" }),
  followups: (pid) => req(`${p(pid)}/ai/followups`, { method: "POST" }),

  docs: (pid, q = "") => req(`${p(pid)}/documents?q=${encodeURIComponent(q)}`),
  doc: (pid, id) => req(`${p(pid)}/documents/${id}`),
  uploadDoc: (pid, form) => req(`${p(pid)}/documents`, { method: "POST", form }),
  patchDoc: (pid, id, body) => req(`${p(pid)}/documents/${id}`, { method: "PATCH", body }),
  deleteDoc: (pid, id) => req(`${p(pid)}/documents/${id}`, { method: "DELETE" }),
  fileBlob: (pid, id, download = false) => req(`${p(pid)}/documents/${id}/file?download=${download}`, { blob: true }),

  notes: (pid) => req(`${p(pid)}/notes`),
  addNote: (pid, body) => req(`${p(pid)}/notes`, { method: "POST", body }),
  deleteNote: (pid, id) => req(`${p(pid)}/notes/${id}`, { method: "DELETE" }),

  tasks: (pid) => req(`${p(pid)}/tasks`),
  addTask: (pid, body) => req(`${p(pid)}/tasks`, { method: "POST", body }),
  patchTask: (pid, id, body) => req(`${p(pid)}/tasks/${id}`, { method: "PATCH", body }),
  deleteTask: (pid, id) => req(`${p(pid)}/tasks/${id}`, { method: "DELETE" }),

  chatHistory: (pid) => req(`${p(pid)}/chat`),
  chat: (pid, message, language) => req(`${p(pid)}/chat`, { method: "POST", body: { message, language } }),
  chatClear: (pid) => req(`${p(pid)}/chat`, { method: "DELETE" }),

  exportAll: (pid) => req(`${p(pid)}/export`, { blob: true }),
};

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function printBlob(blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        window.open(url, "_blank");
      }
    }, 300);
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120000);
}
