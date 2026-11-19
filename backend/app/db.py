import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DOCCHAIN_DATA", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_doctor INTEGER NOT NULL DEFAULT 0,
  specialty TEXT DEFAULT '',
  license_no TEXT DEFAULT '',
  patient_code TEXT NOT NULL UNIQUE,
  access_pin TEXT NOT NULL,
  dob TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  blood_group TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  allergies TEXT DEFAULT '',
  conditions TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  doc_date TEXT DEFAULT '',
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT DEFAULT '',
  ai_status TEXT NOT NULL DEFAULT 'skipped',
  ai_summary TEXT DEFAULT '',
  ai_json TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_patient ON documents(patient_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON notes(patient_id);

CREATE TABLE IF NOT EXISTS care_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  details TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'screening',
  source TEXT NOT NULL DEFAULT 'self',
  created_at TEXT NOT NULL,
  completed_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_patient ON care_tasks(patient_id);

CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat ON chat_messages(user_id, patient_id);

CREATE TABLE IF NOT EXISTS ai_cache (
  patient_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (patient_id, kind)
);
"""


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATA_DIR / "docchain.db", timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def get_db():
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()
