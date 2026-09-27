import time
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import agent

DASHBOARD = Path(__file__).resolve().parent.parent / "pharmastock-dashboard"
RATE_LIMIT, RATE_WINDOW = 10, 600

app = Flask(__name__, static_folder=str(DASHBOARD), static_url_path="")
CORS(app)
DATA = agent.get_data()
_requests = defaultdict(deque)

def _rate_limited(ip: str) -> bool:
    now, q = time.time(), _requests[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False

@app.get("/")
def index():
    return send_from_directory(DASHBOARD, "index.html")

@app.post("/chat")
def chat():
    body = request.get_json(silent=True) or {}
    message = str(body.get("message", "")).strip()
    history = body.get("history", [])
    history = history[-10:] if isinstance(history, list) else []
    if not message:
        return jsonify({"error": "يرجى كتابة السؤال أولاً."}), 400
    if len(message) > 1000:
        return jsonify({"error": "السؤال طويل جداً."}), 400
    ip = (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()
    if _rate_limited(ip):
        return jsonify({"error": "تم الوصول إلى الحد المسموح من الأسئلة. يرجى المحاولة بعد عدة دقائق."}), 429
    try:
        return jsonify(agent.run_agent(message, history, DATA))
    except RuntimeError as e:
        if str(e) == "NO_KEY":
            return jsonify({"error": "المساعد غير مفعّل حالياً."}), 503
        raise
    except Exception as e:
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            return jsonify({"error": "المساعد مشغول حالياً بسبب كثرة الطلبات. يرجى المحاولة بعد دقيقة."}), 429
        return jsonify({"error": "تعذّر الاتصال بالمساعد حالياً. يرجى المحاولة بعد قليل."}), 502

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
