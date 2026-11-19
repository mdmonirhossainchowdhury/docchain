"""End-to-end smoke test:  python test_e2e.py   (uses a temp database, no API key needed)"""
import io
import os
import tempfile

os.environ["DOCCHAIN_DATA"] = tempfile.mkdtemp()
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"


def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    assert cond, msg


with TestClient(app) as c:
    r = c.post("/api/auth/register", json={"name": "Rina", "email": "rina@x.com", "password": "password123"})
    ok(r.status_code == 200, "patient registers")
    pat = r.json()
    ph = {"Authorization": "Bearer " + pat["token"]}
    pid, code, pin = pat["user"]["id"], pat["user"]["patient_code"], pat["user"]["access_pin"]

    r = c.post("/api/auth/register", json={"name": "Dr Karim", "email": "karim@x.com", "password": "password123", "is_doctor": True, "specialty": "Cardiology"})
    doc = r.json()
    dh = {"Authorization": "Bearer " + doc["token"]}
    did = doc["user"]["id"]
    ok(doc["user"]["is_doctor"] and doc["user"]["patient_code"], "doctor registers and also has a patient ID")

    ok(c.post("/api/auth/login", json={"email": "rina@x.com", "password": "bad"}).status_code == 401, "bad login rejected")
    ok(c.post("/api/auth/login", json={"email": "rina@x.com", "password": "password123"}).status_code == 200, "login works")

    r = c.post(f"/api/patients/{pid}/documents", headers=ph, data={"category": "lab_report", "title": "CBC Nov"}, files={"file": ("cbc.pdf", PDF, "application/pdf")})
    ok(r.status_code == 200, "upload pdf")
    did1 = r.json()["id"]
    ok(c.post(f"/api/patients/{pid}/documents", headers=ph, files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400, "reject bad type")
    ok(c.post(f"/api/patients/{pid}/documents", headers=ph, files={"file": ("fake.pdf", b"not a pdf", "application/pdf")}).status_code == 400, "reject spoofed pdf")
    r = c.get(f"/api/patients/{pid}/documents/{did1}/file", headers=ph)
    ok(r.status_code == 200 and r.content.startswith(b"%PDF"), "preview file")
    r = c.get(f"/api/patients/{pid}/documents/{did1}/file?download=true", headers=ph)
    ok("attachment" in r.headers["content-disposition"], "download file")

    ok(c.get(f"/api/patients/{pid}/documents", headers=dh).status_code == 403, "doctor blocked without access")
    ok(c.post("/api/doctor/access", headers=dh, json={"patient_code": code, "pin": "000000"}).status_code == 404, "wrong PIN rejected")
    ok(c.post("/api/doctor/access", headers=ph, json={"patient_code": code, "pin": pin}).status_code == 403, "patient cannot use doctor portal")
    r = c.post("/api/doctor/access", headers=dh, json={"patient_code": code.lower(), "pin": pin})
    ok(r.status_code == 200 and r.json()["patient"]["name"] == "Rina", "doctor opens patient by ID + PIN")
    ok(len(c.get(f"/api/patients/{pid}/documents", headers=dh).json()) == 1, "doctor sees history")
    ok(c.delete(f"/api/patients/{pid}/documents/{did1}", headers=dh).status_code == 403, "doctor cannot delete patient records")

    r = c.post(f"/api/patients/{pid}/notes", headers=dh, json={"kind": "doctor_advice", "content": "Repeat CBC in 3 months"})
    ok(r.status_code == 200 and r.json()["author_is_doctor"] == 1, "doctor adds advice")
    ok(c.post(f"/api/patients/{pid}/notes", headers=ph, json={"kind": "tip", "content": "Drink water"}).status_code == 200, "patient adds tip")
    r = c.post(f"/api/patients/{pid}/tasks", headers=dh, json={"title": "Repeat CBC", "stage": "flagged", "due_date": "2020-01-01"})
    ok(r.json()["source"] == "doctor" and r.json()["overdue"], "doctor adds overdue care-loop item")
    tid = r.json()["id"]
    ok(c.patch(f"/api/patients/{pid}/tasks/{tid}", headers=ph, json={"stage": "completed"}).json()["stage"] == "completed", "move task to completed")

    s = c.get(f"/api/patients/{pid}/summary", headers=ph).json()
    ok(s["counts"]["documents"] == 1 and s["counts"]["loop_rate"] == 100, "summary counts")
    r = c.post(f"/api/patients/{pid}/chat", headers=ph, json={"message": "What does my CBC show?"})
    ok(r.status_code == 200 and "CBC" in r.json()["reply"], "chat works offline")
    ok(len(c.get(f"/api/patients/{pid}/chat", headers=ph).json()) == 2, "chat history saved")
    ok(c.get("/api/me/audit", headers=ph).json()["log"], "patient sees audit log")
    r = c.get(f"/api/patients/{pid}/export", headers=ph)
    ok(r.status_code == 200 and r.content[:2] == b"PK", "export zip")
    ok(c.get(f"/api/patients/{pid}/export", headers=dh).status_code == 403, "doctor cannot export")

    # doctor is also a patient
    ok(c.post(f"/api/patients/{did}/notes", headers=dh, json={"content": "My own note"}).status_code == 200, "doctor uses own patient record")
    ok(c.get(f"/api/patients/{did}/documents", headers=ph).status_code == 403, "patient cannot read doctor's record")

    old = pin
    new = c.post("/api/me/rotate-pin", headers=ph).json()["access_pin"]
    ok(new != old, "pin rotates")
    c.delete("/api/me/grants", headers=ph)
    ok(c.get(f"/api/patients/{pid}/documents", headers=dh).status_code == 403, "patient can revoke doctor access")

import app.llm as llm  # noqa: E402

ok(llm.parse_json('```json\n[{"a":1}]\n```') == [{"a": 1}], "llm json parser")
print("\nALL TESTS PASSED")
