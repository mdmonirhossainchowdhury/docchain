import io
import json
import logging
import os
import re
import secrets
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import llm
from .auth import create_token, current_user, hash_password, verify_password
from .db import UPLOAD_DIR, get_conn, get_db, init_db

log = logging.getLogger("docchain")

STAGES = ["screening", "flagged", "referred", "follow_up", "completed"]
CATEGORIES = {"prescription", "lab_report", "xray", "scan", "discharge", "vaccination", "insurance", "other"}
NOTE_KINDS = {"doctor_advice", "note", "tip", "symptom", "medication", "vitals", "question"}
ALLOWED_EXT = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".txt": "text/plain",
}
MAX_UPLOAD = 25 * 1024 * 1024
ACCESS_HOURS = float(os.getenv("ACCESS_HOURS", "2"))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="DocChain API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ helpers
def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def in_hours(h: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_patient_code(conn) -> str:
    while True:
        code = "DC-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not conn.execute("SELECT 1 FROM users WHERE patient_code=?", (code,)).fetchone():
            return code


def new_pin() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def age_of(dob: str) -> Optional[int]:
    try:
        d = date.fromisoformat(dob)
        t = date.today()
        return t.year - d.year - ((t.month, t.day) < (d.month, d.day))
    except Exception:
        return None


def own_user(u: dict) -> dict:
    keys = ("id", "name", "email", "is_doctor", "specialty", "license_no", "patient_code", "access_pin",
            "dob", "gender", "blood_group", "phone", "allergies", "conditions", "created_at")
    d = {k: u[k] for k in keys}
    d["is_doctor"] = bool(d["is_doctor"])
    d["age"] = age_of(u["dob"] or "")
    return d


def patient_view(u) -> dict:
    keys = ("id", "name", "patient_code", "dob", "gender", "blood_group", "phone", "allergies", "conditions")
    d = {k: u[k] for k in keys}
    d["age"] = age_of(u["dob"] or "")
    return d


def audit(conn, patient_id: int, actor_id: int, action: str, detail: str = "", dedupe_min: int = 0):
    if dedupe_min:
        since = (datetime.now(timezone.utc) - timedelta(minutes=dedupe_min)).strftime("%Y-%m-%dT%H:%M:%SZ")
        if conn.execute(
            "SELECT 1 FROM audit WHERE patient_id=? AND actor_id=? AND action=? AND detail=? AND created_at>?",
            (patient_id, actor_id, action, detail, since),
        ).fetchone():
            return
    conn.execute(
        "INSERT INTO audit(patient_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?)",
        (patient_id, actor_id, action, detail, now()),
    )
    conn.commit()


def check_access(conn, user: dict, pid: int) -> str:
    """Return 'owner' or 'doctor'; raise 403 otherwise."""
    if user["id"] == pid:
        return "owner"
    if not user["is_doctor"]:
        raise HTTPException(403, "You do not have access to this patient")
    g = conn.execute(
        "SELECT 1 FROM grants WHERE doctor_id=? AND patient_id=? AND expires_at>?", (user["id"], pid, now())
    ).fetchone()
    if not g:
        raise HTTPException(403, "Access expired or not granted. Enter the patient's ID and PIN again.")
    return "doctor"


_fail = {}  # simple in-memory brute-force limiter


def throttle(key: str, limit: int = 6, window: int = 600):
    t = time.time()
    hits = [x for x in _fail.get(key, []) if t - x < window]
    _fail[key] = hits
    if len(hits) >= limit:
        raise HTTPException(429, "Too many failed attempts. Try again in a few minutes.")


def record_fail(key: str):
    _fail.setdefault(key, []).append(time.time())


def sniff_ok(ext: str, head: bytes) -> bool:
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext == ".png":
        return head.startswith(b"\x89PNG")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8")
    if ext == ".gif":
        return head.startswith(b"GIF8")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    return True


def extract_text(path: Path, mime: str) -> str:
    try:
        if mime == "text/plain":
            return path.read_text(errors="ignore")[:20000]
        if mime == "application/pdf":
            from pypdf import PdfReader

            reader = PdfReader(str(path))
            out = []
            for page in reader.pages[:30]:
                out.append(page.extract_text() or "")
                if sum(map(len, out)) > 20000:
                    break
            return "\n".join(out)[:20000]
    except Exception as e:  # noqa: BLE001
        log.warning("text extraction failed: %s", e)
    return ""


def analyze_document(doc_id: int):
    conn = get_conn()
    try:
        d = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not d:
            return
        path = UPLOAD_DIR / str(d["patient_id"]) / d["stored_name"]
        text = extract_text(path, d["mime"])
        status, summary, ai_json = "skipped", "", ""
        if llm.available():
            try:
                res = llm.analyze_file(path, d["mime"], text)
                status, summary, ai_json = "done", str(res.get("summary", "")), json.dumps(res)
            except Exception as e:  # noqa: BLE001
                log.warning("analysis failed for doc %s: %s", doc_id, e)
                status = "failed"
        conn.execute(
            "UPDATE documents SET extracted_text=?, ai_status=?, ai_summary=?, ai_json=? WHERE id=?",
            (text, status, summary, ai_json, doc_id),
        )
        conn.commit()
    finally:
        conn.close()


def doc_row(r, include_ai=False) -> dict:
    d = {
        "id": r["id"], "patient_id": r["patient_id"], "category": r["category"], "title": r["title"],
        "doc_date": r["doc_date"], "filename": r["filename"], "mime": r["mime"], "size": r["size"],
        "ai_status": r["ai_status"], "ai_summary": r["ai_summary"], "created_at": r["created_at"],
        "uploaded_by_name": r["uploader"] if "uploader" in r.keys() else "",
        "uploaded_by": r["uploaded_by"],
    }
    if include_ai:
        try:
            d["ai"] = json.loads(r["ai_json"]) if r["ai_json"] else None
        except Exception:  # noqa: BLE001
            d["ai"] = None
    return d


DOC_SELECT = "SELECT d.*, u.name AS uploader FROM documents d JOIN users u ON u.id=d.uploaded_by"


def build_items(conn, pid: int):
    """Flat list of record snippets used for context and offline search."""
    items = []
    for r in conn.execute(f"{DOC_SELECT} WHERE d.patient_id=? ORDER BY d.id DESC LIMIT 40", (pid,)):
        parts = []
        if r["ai_json"]:
            try:
                a = json.loads(r["ai_json"])
                parts.append("Summary: " + str(a.get("summary", "")))
                for k in ("key_findings", "abnormal_values", "red_flags"):
                    if a.get(k):
                        parts.append(k.replace("_", " ").title() + ": " + "; ".join(map(str, a[k])))
                if a.get("medications"):
                    parts.append("Medications: " + "; ".join(
                        f"{m.get('name','')} {m.get('dose','')} {m.get('instructions','')}".strip() for m in a["medications"] if isinstance(m, dict)))
            except Exception:  # noqa: BLE001
                pass
        if not parts and r["extracted_text"]:
            parts.append("Text: " + r["extracted_text"][:1500])
        items.append({"kind": f"document/{r['category']}", "title": f"{r['title']} (#{r['id']}, {r['doc_date'] or r['created_at'][:10]})", "text": "\n".join(parts)})
    for r in conn.execute("SELECT n.*, u.name AS author FROM notes n JOIN users u ON u.id=n.author_id WHERE n.patient_id=? ORDER BY n.id DESC LIMIT 40", (pid,)):
        items.append({"kind": f"note/{r['kind']}", "title": f"{r['title'] or r['kind']} by {r['author']} ({r['created_at'][:10]})", "text": r["content"]})
    for r in conn.execute("SELECT * FROM care_tasks WHERE patient_id=? ORDER BY id DESC LIMIT 40", (pid,)):
        items.append({"kind": "care_task", "title": f"{r['title']} [{r['stage']}] due {r['due_date'] or 'n/a'}", "text": r["details"]})
    return items


def build_context(conn, pid: int, limit: int = 14000) -> str:
    p = conn.execute("SELECT * FROM users WHERE id=?", (pid,)).fetchone()
    head = (
        f"Patient: {p['name']}; age: {age_of(p['dob'] or '') or 'unknown'}; gender: {p['gender'] or 'unknown'}; "
        f"blood group: {p['blood_group'] or 'unknown'}; allergies: {p['allergies'] or 'none recorded'}; "
        f"known conditions: {p['conditions'] or 'none recorded'}; today: {date.today().isoformat()}"
    )
    lines = [head, ""]
    for it in build_items(conn, pid):
        lines.append(f"[{it['kind']}] {it['title']}\n{it['text']}\n")
    text = "\n".join(lines)
    return text[:limit] if text.strip() else head + "\n(No records yet.)"


def signature(conn, pid: int) -> str:
    a = conn.execute("SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(SUM(ai_status='done'),0) FROM documents WHERE patient_id=?", (pid,)).fetchone()
    b = conn.execute("SELECT COUNT(*), COALESCE(MAX(id),0) FROM notes WHERE patient_id=?", (pid,)).fetchone()
    c = conn.execute("SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(SUM(stage='completed'),0) FROM care_tasks WHERE patient_id=?", (pid,)).fetchone()
    return ":".join(map(str, [*tuple(a), *tuple(b), *tuple(c)]))


# ------------------------------------------------------------------ schemas
class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    is_doctor: bool = False
    specialty: str = ""
    license_no: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    phone: Optional[str] = None
    allergies: Optional[str] = None
    conditions: Optional[str] = None
    specialty: Optional[str] = None
    license_no: Optional[str] = None


class AccessIn(BaseModel):
    patient_code: str
    pin: str


class NoteIn(BaseModel):
    kind: str = "note"
    title: str = ""
    content: str


class TaskIn(BaseModel):
    title: str
    details: str = ""
    due_date: Optional[str] = ""
    stage: str = "screening"
    source: str = "self"


class TaskPatch(BaseModel):
    title: Optional[str] = None
    details: Optional[str] = None
    due_date: Optional[str] = None
    stage: Optional[str] = None


class DocPatch(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    doc_date: Optional[str] = None


class ChatIn(BaseModel):
    message: str
    language: str = "auto"


# ------------------------------------------------------------------ auth
@app.get("/api/health")
def health():
    return {"ok": True, "ai": llm.available(), "model": llm.MODEL if llm.available() else None}


@app.post("/api/auth/register")
def register(body: RegisterIn, conn=Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    cur = conn.execute(
        "INSERT INTO users(name,email,password_hash,is_doctor,specialty,license_no,patient_code,access_pin,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (body.name.strip(), email, hash_password(body.password), int(body.is_doctor), body.specialty.strip(),
         body.license_no.strip(), new_patient_code(conn), new_pin(), now()),
    )
    conn.commit()
    u = dict(conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())
    return {"token": create_token(u["id"]), "user": own_user(u)}


@app.post("/api/auth/login")
def login(body: LoginIn, conn=Depends(get_db)):
    email = body.email.strip().lower()
    throttle("login:" + email)
    row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        record_fail("login:" + email)
        raise HTTPException(401, "Incorrect email or password")
    return {"token": create_token(row["id"]), "user": own_user(dict(row))}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return own_user(user)


@app.put("/api/me")
def update_me(body: ProfileIn, user=Depends(current_user), conn=Depends(get_db)):
    data = {k: v.strip() for k, v in body.model_dump().items() if v is not None}
    if "name" in data and not data["name"]:
        raise HTTPException(400, "Name cannot be empty")
    if data.get("dob"):
        try:
            date.fromisoformat(data["dob"])
        except ValueError:
            raise HTTPException(400, "Date of birth must be YYYY-MM-DD")
    if not user["is_doctor"]:
        data.pop("specialty", None)
        data.pop("license_no", None)
    if data:
        sets = ", ".join(f"{k}=?" for k in data)
        conn.execute(f"UPDATE users SET {sets} WHERE id=?", (*data.values(), user["id"]))
        conn.commit()
    return own_user(dict(conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()))


@app.post("/api/me/rotate-pin")
def rotate_pin(user=Depends(current_user), conn=Depends(get_db)):
    pin = new_pin()
    conn.execute("UPDATE users SET access_pin=? WHERE id=?", (pin, user["id"]))
    conn.commit()
    audit(conn, user["id"], user["id"], "pin_rotated")
    return {"access_pin": pin}


@app.delete("/api/me/grants")
def revoke_all(user=Depends(current_user), conn=Depends(get_db)):
    conn.execute("DELETE FROM grants WHERE patient_id=?", (user["id"],))
    conn.commit()
    audit(conn, user["id"], user["id"], "access_revoked")
    return {"ok": True}


@app.get("/api/me/audit")
def my_audit(user=Depends(current_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT a.*, u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.patient_id=? ORDER BY a.id DESC LIMIT 100",
        (user["id"],),
    ).fetchall()
    active = conn.execute(
        "SELECT g.*, u.name AS doctor_name, u.specialty FROM grants g JOIN users u ON u.id=g.doctor_id WHERE g.patient_id=? AND g.expires_at>?",
        (user["id"], now()),
    ).fetchall()
    return {"log": [dict(r) for r in rows], "active": [dict(r) for r in active]}


# ------------------------------------------------------------------ doctor access
@app.post("/api/doctor/access")
def doctor_access(body: AccessIn, user=Depends(current_user), conn=Depends(get_db)):
    if not user["is_doctor"]:
        raise HTTPException(403, "Only doctor accounts can open patient records")
    key = f"access:{user['id']}"
    throttle(key)
    code = body.patient_code.strip().upper()
    p = conn.execute("SELECT * FROM users WHERE patient_code=?", (code,)).fetchone()
    if not p or not secrets.compare_digest(p["access_pin"], body.pin.strip()):
        record_fail(key)
        raise HTTPException(404, "Patient ID and PIN do not match")
    if p["id"] == user["id"]:
        raise HTTPException(400, "That is your own ID. Use 'My records' instead.")
    conn.execute("DELETE FROM grants WHERE doctor_id=? AND patient_id=?", (user["id"], p["id"]))
    conn.execute("INSERT INTO grants(doctor_id,patient_id,expires_at,created_at) VALUES(?,?,?,?)",
                 (user["id"], p["id"], in_hours(ACCESS_HOURS), now()))
    conn.commit()
    audit(conn, p["id"], user["id"], "access_granted", f"Dr. {user['name']} opened your records")
    return {"patient": patient_view(p), "expires_hours": ACCESS_HOURS}


@app.get("/api/doctor/grants")
def doctor_grants(user=Depends(current_user), conn=Depends(get_db)):
    if not user["is_doctor"]:
        raise HTTPException(403, "Doctors only")
    rows = conn.execute(
        "SELECT g.expires_at, u.* FROM grants g JOIN users u ON u.id=g.patient_id WHERE g.doctor_id=? AND g.expires_at>? ORDER BY g.id DESC",
        (user["id"], now()),
    ).fetchall()
    return [{**patient_view(r), "expires_at": r["expires_at"]} for r in rows]


@app.delete("/api/doctor/grants/{pid}")
def doctor_close(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    conn.execute("DELETE FROM grants WHERE doctor_id=? AND patient_id=?", (user["id"], pid))
    conn.commit()
    return {"ok": True}


# ------------------------------------------------------------------ patient-scoped data
@app.get("/api/patients/{pid}/profile")
def get_profile(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    return patient_view(conn.execute("SELECT * FROM users WHERE id=?", (pid,)).fetchone())


@app.get("/api/patients/{pid}/summary")
def summary(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    role = check_access(conn, user, pid)
    if role == "doctor":
        audit(conn, pid, user["id"], "viewed_summary", f"Dr. {user['name']}", dedupe_min=10)
    docs = conn.execute("SELECT id,category,title,doc_date,created_at FROM documents WHERE patient_id=?", (pid,)).fetchall()
    notes = conn.execute("SELECT id,kind,title,content,created_at FROM notes WHERE patient_id=?", (pid,)).fetchall()
    tasks = conn.execute("SELECT * FROM care_tasks WHERE patient_id=?", (pid,)).fetchall()
    today = date.today().isoformat()
    by_cat = {}
    for d in docs:
        by_cat[d["category"]] = by_cat.get(d["category"], 0) + 1
    open_tasks = [t for t in tasks if t["stage"] != "completed"]
    overdue = [t for t in open_tasks if t["due_date"] and t["due_date"] < today]
    done = len(tasks) - len(open_tasks)
    timeline = []
    for d in docs:
        timeline.append({"type": "document", "id": d["id"], "title": d["title"], "sub": d["category"], "date": d["doc_date"] or d["created_at"][:10]})
    for n in notes:
        timeline.append({"type": "note", "id": n["id"], "title": n["title"] or n["kind"].replace("_", " ").title(), "sub": n["content"][:90], "date": n["created_at"][:10]})
    for t in tasks:
        timeline.append({"type": "task", "id": t["id"], "title": t["title"], "sub": t["stage"], "date": t["due_date"] or t["created_at"][:10]})
    timeline.sort(key=lambda x: x["date"], reverse=True)

    if docs:
        cats = ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in by_cat.items())
        text = f"You have {len(docs)} medical record(s) ({cats}) and {len(notes)} note(s)."
        latest = sorted(docs, key=lambda d: d["doc_date"] or d["created_at"][:10], reverse=True)[0]
        text += f" Latest record: {latest['title']}."
    else:
        text = "No records yet. Upload a prescription, lab report or X-ray to build your health history."
    if overdue:
        text += f" {len(overdue)} follow-up item(s) are overdue."
    p = conn.execute("SELECT * FROM users WHERE id=?", (pid,)).fetchone()
    return {
        "profile": patient_view(p),
        "counts": {"documents": len(docs), "notes": len(notes), "open_tasks": len(open_tasks), "overdue": len(overdue),
                   "completed": done, "loop_rate": round(100 * done / len(tasks)) if tasks else None},
        "by_category": by_cat,
        "timeline": timeline[:12],
        "text": text,
    }


# ---- documents
@app.get("/api/patients/{pid}/documents")
def list_docs(pid: int, q: str = "", user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    sql = f"{DOC_SELECT} WHERE d.patient_id=?"
    args = [pid]
    if q.strip():
        sql += " AND (d.title LIKE ? OR d.extracted_text LIKE ? OR d.ai_summary LIKE ?)"
        args += [f"%{q.strip()}%"] * 3
    sql += " ORDER BY COALESCE(NULLIF(d.doc_date,''), substr(d.created_at,1,10)) DESC, d.id DESC"
    return [doc_row(r) for r in conn.execute(sql, args)]


@app.post("/api/patients/{pid}/documents")
async def upload_document(
    pid: int,
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Form("other"),
    title: str = Form(""),
    doc_date: str = Form(""),
    user=Depends(current_user),
    conn=Depends(get_db),
):
    role = check_access(conn, user, pid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Unsupported file type. Use PDF, PNG, JPG, WEBP, GIF or TXT.")
    if category not in CATEGORIES:
        category = "other"
    if doc_date:
        try:
            date.fromisoformat(doc_date)
        except ValueError:
            raise HTTPException(400, "Date must be YYYY-MM-DD")
    folder = UPLOAD_DIR / str(pid)
    folder.mkdir(parents=True, exist_ok=True)
    stored = uuid.uuid4().hex + ext
    path = folder / stored
    size, head = 0, b""
    with open(path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            if not head:
                head = chunk[:16]
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "File is larger than 25 MB")
            out.write(chunk)
    if size == 0 or not sniff_ok(ext, head):
        path.unlink(missing_ok=True)
        raise HTTPException(400, "File is empty or does not match its extension")
    clean_title = title.strip() or Path(file.filename).stem[:120]
    status = "pending" if llm.available() else "skipped"
    cur = conn.execute(
        "INSERT INTO documents(patient_id,uploaded_by,category,title,doc_date,filename,stored_name,mime,size,ai_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (pid, user["id"], category, clean_title, doc_date, Path(file.filename).name, stored, ALLOWED_EXT[ext], size, status, now()),
    )
    conn.commit()
    if role == "doctor":
        audit(conn, pid, user["id"], "uploaded_document", clean_title)
    bg.add_task(analyze_document, cur.lastrowid)
    return doc_row(conn.execute(f"{DOC_SELECT} WHERE d.id=?", (cur.lastrowid,)).fetchone())


def get_doc(conn, user, pid, doc_id):
    role = check_access(conn, user, pid)
    r = conn.execute(f"{DOC_SELECT} WHERE d.id=? AND d.patient_id=?", (doc_id, pid)).fetchone()
    if not r:
        raise HTTPException(404, "Document not found")
    return role, r


@app.get("/api/patients/{pid}/documents/{doc_id}")
def doc_detail(pid: int, doc_id: int, user=Depends(current_user), conn=Depends(get_db)):
    _, r = get_doc(conn, user, pid, doc_id)
    return doc_row(r, include_ai=True)


@app.patch("/api/patients/{pid}/documents/{doc_id}")
def doc_patch(pid: int, doc_id: int, body: DocPatch, user=Depends(current_user), conn=Depends(get_db)):
    role, r = get_doc(conn, user, pid, doc_id)
    if role != "owner" and r["uploaded_by"] != user["id"]:
        raise HTTPException(403, "Only the patient or the uploader can edit this record")
    data = {k: v.strip() for k, v in body.model_dump().items() if v is not None}
    if "category" in data and data["category"] not in CATEGORIES:
        raise HTTPException(400, "Unknown category")
    if data.get("title") == "":
        raise HTTPException(400, "Title cannot be empty")
    if data:
        conn.execute(f"UPDATE documents SET {', '.join(k + '=?' for k in data)} WHERE id=?", (*data.values(), doc_id))
        conn.commit()
    return doc_row(conn.execute(f"{DOC_SELECT} WHERE d.id=?", (doc_id,)).fetchone())


@app.get("/api/patients/{pid}/documents/{doc_id}/file")
def doc_file(pid: int, doc_id: int, download: bool = False, user=Depends(current_user), conn=Depends(get_db)):
    role, r = get_doc(conn, user, pid, doc_id)
    path = UPLOAD_DIR / str(pid) / r["stored_name"]
    if not path.exists():
        raise HTTPException(404, "File missing on server")
    if role == "doctor":
        audit(conn, pid, user["id"], "downloaded_document" if download else "viewed_document", r["title"], dedupe_min=10)
    return FileResponse(path, media_type=r["mime"], filename=r["filename"],
                        content_disposition_type="attachment" if download else "inline")


@app.delete("/api/patients/{pid}/documents/{doc_id}")
def doc_delete(pid: int, doc_id: int, user=Depends(current_user), conn=Depends(get_db)):
    role, r = get_doc(conn, user, pid, doc_id)
    if role != "owner":
        raise HTTPException(403, "Only the patient can delete records")
    (UPLOAD_DIR / str(pid) / r["stored_name"]).unlink(missing_ok=True)
    conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    conn.commit()
    return {"ok": True}


# ---- notes
@app.get("/api/patients/{pid}/notes")
def list_notes(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    rows = conn.execute(
        "SELECT n.*, u.name AS author_name, u.is_doctor AS author_is_doctor FROM notes n JOIN users u ON u.id=n.author_id WHERE n.patient_id=? ORDER BY n.id DESC",
        (pid,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/patients/{pid}/notes")
def add_note(pid: int, body: NoteIn, user=Depends(current_user), conn=Depends(get_db)):
    role = check_access(conn, user, pid)
    if not body.content.strip():
        raise HTTPException(400, "Write something first")
    kind = body.kind if body.kind in NOTE_KINDS else "note"
    cur = conn.execute("INSERT INTO notes(patient_id,author_id,kind,title,content,created_at) VALUES(?,?,?,?,?,?)",
                       (pid, user["id"], kind, body.title.strip()[:120], body.content.strip()[:8000], now()))
    conn.commit()
    if role == "doctor":
        audit(conn, pid, user["id"], "added_note", kind)
    r = conn.execute("SELECT n.*, u.name AS author_name, u.is_doctor AS author_is_doctor FROM notes n JOIN users u ON u.id=n.author_id WHERE n.id=?", (cur.lastrowid,)).fetchone()
    return dict(r)


@app.delete("/api/patients/{pid}/notes/{nid}")
def del_note(pid: int, nid: int, user=Depends(current_user), conn=Depends(get_db)):
    role = check_access(conn, user, pid)
    r = conn.execute("SELECT * FROM notes WHERE id=? AND patient_id=?", (nid, pid)).fetchone()
    if not r:
        raise HTTPException(404, "Note not found")
    if role != "owner" and r["author_id"] != user["id"]:
        raise HTTPException(403, "You can only delete your own notes")
    conn.execute("DELETE FROM notes WHERE id=?", (nid,))
    conn.commit()
    return {"ok": True}


# ---- care loop tasks
def task_dict(r):
    d = dict(r)
    d["overdue"] = bool(d["due_date"] and d["stage"] != "completed" and d["due_date"] < date.today().isoformat())
    return d


@app.get("/api/patients/{pid}/tasks")
def list_tasks(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    return [task_dict(r) for r in conn.execute("SELECT * FROM care_tasks WHERE patient_id=? ORDER BY COALESCE(NULLIF(due_date,''),'9999'), id", (pid,))]


@app.post("/api/patients/{pid}/tasks")
def add_task(pid: int, body: TaskIn, user=Depends(current_user), conn=Depends(get_db)):
    role = check_access(conn, user, pid)
    if not body.title.strip():
        raise HTTPException(400, "Title is required")
    stage = body.stage if body.stage in STAGES else "screening"
    source = "doctor" if role == "doctor" else (body.source if body.source in ("self", "ai") else "self")
    due = body.due_date or ""
    if due:
        try:
            date.fromisoformat(due)
        except ValueError:
            raise HTTPException(400, "Due date must be YYYY-MM-DD")
    cur = conn.execute(
        "INSERT INTO care_tasks(patient_id,created_by,title,details,due_date,stage,source,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (pid, user["id"], body.title.strip()[:200], body.details.strip()[:2000], due, stage, source, now(), now() if stage == "completed" else ""),
    )
    conn.commit()
    if role == "doctor":
        audit(conn, pid, user["id"], "added_followup", body.title.strip()[:80])
    return task_dict(conn.execute("SELECT * FROM care_tasks WHERE id=?", (cur.lastrowid,)).fetchone())


@app.patch("/api/patients/{pid}/tasks/{tid}")
def patch_task(pid: int, tid: int, body: TaskPatch, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    r = conn.execute("SELECT * FROM care_tasks WHERE id=? AND patient_id=?", (tid, pid)).fetchone()
    if not r:
        raise HTTPException(404, "Item not found")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "stage" in data:
        if data["stage"] not in STAGES:
            raise HTTPException(400, "Unknown stage")
        data["completed_at"] = now() if data["stage"] == "completed" else ""
    if data.get("due_date"):
        try:
            date.fromisoformat(data["due_date"])
        except ValueError:
            raise HTTPException(400, "Due date must be YYYY-MM-DD")
    if data:
        conn.execute(f"UPDATE care_tasks SET {', '.join(k + '=?' for k in data)} WHERE id=?", (*data.values(), tid))
        conn.commit()
    return task_dict(conn.execute("SELECT * FROM care_tasks WHERE id=?", (tid,)).fetchone())


@app.delete("/api/patients/{pid}/tasks/{tid}")
def del_task(pid: int, tid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    conn.execute("DELETE FROM care_tasks WHERE id=? AND patient_id=?", (tid, pid))
    conn.commit()
    return {"ok": True}


# ---- AI
@app.post("/api/patients/{pid}/ai/snapshot")
def ai_snapshot(pid: int, force: bool = False, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    if not llm.available():
        return {"text": None, "ai": False}
    sig = signature(conn, pid)
    c = conn.execute("SELECT * FROM ai_cache WHERE patient_id=? AND kind='snapshot'", (pid,)).fetchone()
    if c and c["signature"] == sig and not force:
        return {"text": c["content"], "ai": True, "cached": True}
    try:
        text = llm.complete(llm.SNAPSHOT_SYSTEM, [{"role": "user", "content": build_context(conn, pid) + "\n\nWrite the health snapshot."}], 700)
    except Exception as e:  # noqa: BLE001
        log.warning("snapshot failed: %s", e)
        return {"text": None, "ai": True, "error": "AI is temporarily unavailable"}
    conn.execute("INSERT OR REPLACE INTO ai_cache(patient_id,kind,signature,content,created_at) VALUES(?,?,?,?,?)", (pid, "snapshot", sig, text, now()))
    conn.commit()
    return {"text": text, "ai": True, "cached": False}




@app.post("/api/patients/{pid}/ai/followups")
def ai_followups(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    if not llm.available():
        return {"suggestions": [], "ai": False}
    try:
        reply = llm.complete(llm.FOLLOWUP_SYSTEM, [{"role": "user", "content": build_context(conn, pid)}], 900)
        data = llm.parse_json(reply)
    except Exception as e:  # noqa: BLE001
        log.warning("followups failed: %s", e)
        return {"suggestions": [], "ai": True, "error": "Could not generate suggestions right now"}
    out = []
    for s in data if isinstance(data, list) else []:
        if not isinstance(s, dict) or not s.get("title"):
            continue
        days = s.get("due_in_days")
        due = (date.today() + timedelta(days=int(days))).isoformat() if isinstance(days, (int, float)) else ""
        out.append({"title": str(s["title"])[:200], "details": str(s.get("details", ""))[:500], "due_date": due,
                    "stage": s.get("stage") if s.get("stage") in STAGES else "follow_up"})
    return {"suggestions": out[:6], "ai": True}


@app.get("/api/patients/{pid}/chat")
def chat_history(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    rows = conn.execute("SELECT role,content,created_at FROM chat_messages WHERE user_id=? AND patient_id=? ORDER BY id", (user["id"], pid)).fetchall()
    return [dict(r) for r in rows]


@app.delete("/api/patients/{pid}/chat")
def chat_clear(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    check_access(conn, user, pid)
    conn.execute("DELETE FROM chat_messages WHERE user_id=? AND patient_id=?", (user["id"], pid))
    conn.commit()
    return {"ok": True}


@app.post("/api/patients/{pid}/chat")
def chat(pid: int, body: ChatIn, user=Depends(current_user), conn=Depends(get_db)):
    role = check_access(conn, user, pid)
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Type a message")
    msg = msg[:4000]
    if not llm.available():
        reply = llm.offline_answer(msg, build_items(conn, pid))
        ai = False
    else:
        system = llm.CHAT_SYSTEM_DOCTOR if role == "doctor" else llm.CHAT_SYSTEM_PATIENT
        if body.language == "bn":
            system += "\nAlways reply in Bangla (বাংলা)."
        elif body.language == "en":
            system += "\nAlways reply in English."
        system += "\n\n# PATIENT RECORDS\n" + build_context(conn, pid)
        hist = conn.execute(
            "SELECT role,content FROM (SELECT * FROM chat_messages WHERE user_id=? AND patient_id=? ORDER BY id DESC LIMIT 14) ORDER BY id",
            (user["id"], pid),
        ).fetchall()
        msgs = [{"role": h["role"], "content": h["content"]} for h in hist]
        while msgs and msgs[0]["role"] != "user":
            msgs.pop(0)
        if msgs and msgs[-1]["role"] == "user":
            msgs.pop()
        msgs.append({"role": "user", "content": msg})
        try:
            reply = llm.complete(system, msgs, 1400)
            ai = True
        except Exception as e:  # noqa: BLE001
            log.warning("chat failed: %s", e)
            raise HTTPException(502, "The AI assistant is unavailable right now. Please try again.")
    conn.execute("INSERT INTO chat_messages(user_id,patient_id,role,content,created_at) VALUES(?,?,?,?,?)", (user["id"], pid, "user", msg, now()))
    conn.execute("INSERT INTO chat_messages(user_id,patient_id,role,content,created_at) VALUES(?,?,?,?,?)", (user["id"], pid, "assistant", reply, now()))
    conn.commit()
    return {"reply": reply, "ai": ai}


# ---- export
@app.get("/api/patients/{pid}/export")
def export_all(pid: int, user=Depends(current_user), conn=Depends(get_db)):
    if check_access(conn, user, pid) != "owner":
        raise HTTPException(403, "Only the patient can export all data")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        meta = []
        for r in conn.execute("SELECT * FROM documents WHERE patient_id=?", (pid,)):
            p = UPLOAD_DIR / str(pid) / r["stored_name"]
            if p.exists():
                z.write(p, f"documents/{r['id']}_{r['filename']}")
            meta.append({k: r[k] for k in ("id", "category", "title", "doc_date", "filename", "ai_summary", "created_at")})
        z.writestr("documents.json", json.dumps(meta, indent=2))
        z.writestr("notes.json", json.dumps([dict(r) for r in conn.execute("SELECT * FROM notes WHERE patient_id=?", (pid,))], indent=2))
        z.writestr("care_loop.json", json.dumps([dict(r) for r in conn.execute("SELECT * FROM care_tasks WHERE patient_id=?", (pid,))], indent=2))
        z.writestr("README.txt", "DocChain export. Your records, notes and care-loop items.\n")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="docchain-export.zip"'})
