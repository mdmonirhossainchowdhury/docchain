"""LLM layer (Anthropic Claude). Everything degrades gracefully when no API key is set."""
import base64
import io
import json
import os
import re
from pathlib import Path

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
_client = None


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def complete(system: str, messages: list, max_tokens: int = 1200) -> str:
    resp = client().messages.create(model=MODEL, max_tokens=max_tokens, system=system, messages=messages)
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


def parse_json(text: str):
    """Pull the first JSON object/array out of an LLM reply."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    pairs = [(text.find(o), o, c) for o, c in (("{", "}"), ("[", "]")) if text.find(o) != -1]
    for s, _, close_c in sorted(pairs):
        e = text.rfind(close_c)
        if e > s:
            try:
                return json.loads(text[s : e + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError("No JSON found in model reply")


# ---------------------------------------------------------------- prompts
CHAT_SYSTEM_PATIENT = """You are DocChain Assistant, a warm, careful guide that helps a patient understand their own medical records and take the next right step in their care.

Rules:
- Ground answers in the PATIENT RECORDS below. Mention which document or note you used (by title). If something is not in the records, say so; never invent results.
- Explain medical terms and lab values in plain language. Do not give a definitive diagnosis or change prescribed doses. Suggest what to ask the doctor and what follow-up/screening may be due.
- Spot gaps in the screening-to-care loop: abnormal results with no follow-up, referrals not completed, overdue tasks. Point them out kindly and suggest adding them to the Care Loop.
- Red-flag symptoms (chest pain, trouble breathing, stroke signs, heavy bleeding, fainting, suicidal thoughts, severe allergic reaction, etc.): tell the person to get emergency care immediately (in Bangladesh call 999 or go to the nearest hospital).
- Reply in the same language the user writes in (English or Bangla). Be concise: short paragraphs or bullets. Remind them you do not replace a doctor only when it matters."""

CHAT_SYSTEM_DOCTOR = """You are DocChain Clinical Assistant supporting a licensed doctor who is reviewing a patient's shared records.

Rules:
- Use only the PATIENT RECORDS below and cite documents by title. Highlight abnormal findings, medication lists, interactions to double-check, missing follow-ups and open care-loop items.
- Offer decision support (differentials to consider, tests to consider), clearly labelled as suggestions. The clinician makes every final decision.
- Be concise and structured. Reply in the language used by the doctor."""

SNAPSHOT_SYSTEM = """You write a short "health snapshot" shown on a patient dashboard from their uploaded records.
Write 4-7 lines of markdown in plain, friendly language: (1) one-sentence overview, (2) what the latest records show, (3) active medicines/advice if present, (4) what needs follow-up. Only use facts present in the records. If there are no records, say what to upload first. No diagnosis claims."""

FOLLOWUP_SYSTEM = """You are a care-coordination assistant. From the patient records, list follow-up actions that close the screening-to-care loop (repeat tests, specialist referrals, vaccinations, medication reviews, lifestyle advice already recommended). Only propose actions supported by the records. Return ONLY a JSON array (max 6 items) of objects: {"title": str, "details": str, "due_in_days": int, "stage": one of ["flagged","referred","follow_up"]}. Return [] if nothing is supported."""

ANALYZE_PROMPT = """You are a medical records assistant. Read the attached medical document and return ONLY valid JSON with exactly these keys:
"document_type" (string), "summary" (2-3 plain-language sentences), "key_findings" (list of strings), "medications" (list of {"name","dose","instructions"}), "abnormal_values" (list of strings), "follow_up" (list of {"title","details","due_in_days"}), "red_flags" (list of strings).
Use empty lists when there is nothing. Never invent information that is not in the document. If it is unreadable, say so in "summary"."""

IMG_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}


def _image_block(path: Path, mime: str):
    data = path.read_bytes()
    if len(data) > 3_500_000:
        from PIL import Image

        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((2000, 2000))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        data, mime = buf.getvalue(), "image/jpeg"
    return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}}


def analyze_file(path: Path, mime: str, text: str = "") -> dict:
    if mime == "application/pdf":
        if path.stat().st_size > 20_000_000:
            raise ValueError("PDF too large for analysis")
        block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(path.read_bytes()).decode()},
        }
    elif mime.startswith("image/"):
        block = _image_block(path, mime)
    else:
        block = {"type": "text", "text": text[:20000] or "(empty document)"}
    reply = complete(ANALYZE_PROMPT, [{"role": "user", "content": [block, {"type": "text", "text": "Analyze this document."}]}], 1500)
    data = parse_json(reply)
    if not isinstance(data, dict):
        raise ValueError("Unexpected analysis format")
    return data


# ---------------------------------------------------------------- offline fallback
EMERGENCY = re.compile(
    r"chest pain|can'?t breathe|cannot breathe|trouble breathing|stroke|unconscious|heavy bleeding|suicid|overdose|seizure|বুকে ব্যথা|শ্বাস", re.I
)


def offline_answer(question: str, items: list) -> str:
    """Keyword search over the record context when no LLM key is configured."""
    out = []
    if EMERGENCY.search(question):
        out.append("**This may be an emergency.** Call 999 or go to the nearest hospital now.\n")
    stop = {"the", "what", "does", "show", "and", "for", "are", "was", "with", "that", "this", "have", "has", "how", "can", "you", "my", "me", "about", "tell"}
    words = {w for w in re.findall(r"\w{3,}", question.lower()) if w not in stop}
    scored = []
    for it in items:
        blob = (it["title"] + " " + it["text"]).lower()
        score = sum(1 for w in words if w in blob)
        if score:
            scored.append((score, it))
    scored.sort(key=lambda x: -x[0])
    out.append("The AI assistant is running in **offline mode** (no `ANTHROPIC_API_KEY` configured), so I can only search your records.\n")
    if scored:
        out.append("Records that match your question:")
        for _, it in scored[:5]:
            snippet = it["text"].strip().replace("\n", " ")[:240]
            out.append(f"- **{it['title']}** ({it['kind']}): {snippet}")
    else:
        out.append("I couldn't find anything matching that in your records. Try uploading the related report, or add a note.")
    out.append("\nAdd an API key in `backend/.env` to get full explanations, summaries and guidance.")
    return "\n".join(out)
