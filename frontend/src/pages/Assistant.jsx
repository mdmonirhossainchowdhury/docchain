import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import { useApp } from "../state";
import { Spinner } from "../ui";

const PATIENT_SUGG = [
  "Summarize my latest report in simple words",
  "What follow-ups am I missing?",
  "What should I ask my doctor next visit?",
  "আমার সর্বশেষ রিপোর্ট সহজ ভাষায় বুঝিয়ে দিন",
];
const DOCTOR_SUGG = [
  "Give me a clinical summary of this patient",
  "Any abnormal findings or medication concerns?",
  "Which follow-ups are open or overdue?",
];

export default function Assistant() {
  const { pid, viewing, notify } = useApp();
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState("auto");
  const end = useRef();

  useEffect(() => {
    setMsgs(null);
    api.chatHistory(pid).then(setMsgs).catch((e) => { notify(e.message, "err"); setMsgs([]); });
  }, [pid]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (m) => {
    const message = (m ?? text).trim();
    if (!message || busy) return;
    setText("");
    setMsgs((x) => [...x, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await api.chat(pid, message, lang);
      setMsgs((x) => [...x, { role: "assistant", content: r.reply }]);
    } catch (e) {
      notify(e.message, "err");
      setMsgs((x) => x.slice(0, -1));
      setText(message);
    }
    setBusy(false);
  };

  const clear = async () => {
    if (!confirm("Clear this conversation?")) return;
    await api.chatClear(pid).catch(() => {});
    setMsgs([]);
  };

  if (!msgs) return <Spinner label="Loading chat…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>AI Assistant</h2>
          <p>{viewing ? `Clinical decision support for ${viewing.name}'s records.` : "Ask about your reports, medicines and next steps. Answers use your own records."}</p>
        </div>
      </div>
      <div className="card chat">
        <div className="chat-tools">
          <label style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            Language
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="bn">বাংলা</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {msgs.length > 0 && <button className="btn small ghost" onClick={clear}>Clear chat</button>}
        </div>
        <div className="chat-log">
          {msgs.length === 0 && (
            <div>
              <p><strong>👋 How can I help?</strong></p>
              <div className="sugg">
                {(viewing ? DOCTOR_SUGG : PATIENT_SUGG).map((s) => (
                  <button key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === "assistant" ? <div className="md"><ReactMarkdown>{m.content}</ReactMarkdown></div> : m.content}
            </div>
          ))}
          {busy && <div className="bubble assistant typing"><span /><span /><span /></div>}
          <div ref={end} />
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about the records…  (Shift+Enter for a new line)"
            rows={1}
          />
          <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>This assistant gives information, not a diagnosis. In an emergency call 999 or go to the nearest hospital.</p>
    </>
  );
}
