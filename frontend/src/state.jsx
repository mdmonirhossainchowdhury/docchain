import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [viewing, setViewing] = useState(null); // patient a doctor is currently reviewing
  const [toast, setToast] = useState(null);

  const notify = useCallback((msg, type = "ok") => setToast({ msg, type, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (getToken()) refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const h = () => {
      setUser(null);
      setViewing(null);
    };
    window.addEventListener("dc-logout", h);
    return () => window.removeEventListener("dc-logout", h);
  }, []);

  const login = async (email, password) => {
    const r = await api.login(email, password);
    setToken(r.token);
    setUser(r.user);
  };
  const register = async (data) => {
    const r = await api.register(data);
    setToken(r.token);
    setUser(r.user);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
    setViewing(null);
  };

  const pid = viewing ? viewing.id : user?.id;
  const value = { user, loading, login, register, logout, refresh, setUser, viewing, setViewing, pid, notify };
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast ${toast.type}`} role="status">
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
