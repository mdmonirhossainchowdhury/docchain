# DocChain

Portable health records with a **Care Loop**: every screening result is tracked until the patient actually receives care.

Built for the *Population Health: Closing the Screening-to-Care Loop* challenge.

## What it does

| Feature | Details |
|---|---|
| Accounts | Patient or doctor registration. **A doctor is also a patient** (own records, own Patient ID). |
| Records | Upload prescriptions, lab reports, X-rays, scans, discharge papers (PDF / PNG / JPG / WEBP / GIF / TXT, 25 MB). Preview, download, print, search. |
| Overview | On login: stats, timeline, records-by-type, and an **AI health snapshot** written from the patient's own documents. |
| Notes | Doctor's advice, symptoms, tips, medicines, vitals, questions. Voice dictation (English / বাংলা) in Chrome/Edge. |
| Doctor access | Doctor enters **Patient ID + 6-digit PIN**. Access expires (default 2 h), is rate-limited, and every view is written to the patient's access log. Patient can rotate the PIN or end all access instantly. Doctors can add notes/documents/follow-ups, but only the patient can delete records. |
| AI assistant | ChatGPT-style chat grounded in the patient's records (Claude). English and Bangla. Doctors get a clinical decision-support mode for the patient they opened. |
| AI document reading | Each upload is read by Claude (PDF and images): summary, abnormal values, medicines, red flags, suggested follow-ups. |
| **Care Loop** | Kanban: Screening → Flagged → Referred → Follow-up → Care received. Due dates, overdue alerts, "loop closed %" and AI-suggested follow-ups from the records. |
| Data ownership | One-click export of everything as a ZIP. |

Works **without an API key** (offline mode: record search instead of AI). Add a key to switch on the AI.

## Run it

Requirements: Python 3.10+, Node 18+.

### 1) Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # then put your ANTHROPIC_API_KEY in .env
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api to :8000)
```

Open http://localhost:5173, create a patient account, then a doctor account in a private window to try the sharing flow.

### Quick demo script (2 minutes)
1. Register as **patient** → Profile: add allergies/conditions.
2. Records: upload a lab report → open Preview to see the AI reading → click **+ Care Loop** on a suggested follow-up.
3. Care Loop: move the item Flagged → Referred → Care received.
4. Share & Access: copy your Patient ID and PIN.
5. In another window, register as **doctor** → Doctor Portal → enter ID + PIN → review history, ask the AI, add advice.
6. Back as the patient: see the doctor's visit in the access log.

## Tests
```bash
cd backend && python test_e2e.py      # 30+ API checks incl. access control
```

## Project layout
```
backend/app/main.py   API, access control, care loop, AI endpoints
backend/app/llm.py    Claude prompts, document analysis, offline fallback
backend/app/db.py     SQLite schema   |  auth.py  passwords + JWT
frontend/src/pages/   Dashboard, Records, Notes, CareLoop, Assistant, Share, DoctorPortal, Profile
```
Data lives in `backend/data/` (SQLite + uploaded files).

## Security notes / before going to production
- Passwords: PBKDF2-SHA256 (200k). Sessions: signed JWT (7 days). Secret auto-generated in `backend/data/secret.key` unless `JWT_SECRET` is set.
- Uploads are checked by extension **and** file signature; files are stored under random names and only served to authorised users.
- Records are stored unencrypted on disk. For real patients add encryption at rest, HTTPS, a managed database (PostgreSQL) and object storage, backups, and legal review (health-data regulation, consent, retention).
- Document contents are sent to Anthropic's API for analysis when a key is configured; tell users and get consent.
- The AI gives information, not diagnosis.

## Ideas to extend
WhatsApp/SMS reminders for overdue follow-ups · QR code for the Patient ID · DICOM X-ray viewer · clinic/referral directory · family accounts · offline PWA for low-connectivity areas.
