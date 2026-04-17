import os
from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)

SCORING = {
    "d1_trend": {"clear": 3, "unclear": 0},
    "liquidity_sweep": {"strong": 3, "weak": 1, "none": 0},
    "bos_confirmed": {"yes": 2, "no": 0},
    "valid_order_block": {"yes": 2, "no": 0},
    "fvg_confluence": {"yes": 1, "no": 0},
    "session_alignment": {"yes": 1, "no": 0},
    "ltf_confirmation": {"yes": 2, "no": 0},
}

def calculate_score(form):
    score = 0
    score += SCORING["d1_trend"].get(form.get("d1_trend", ""), 0)
    score += SCORING["liquidity_sweep"].get(form.get("liquidity_sweep", ""), 0)
    score += SCORING["bos_confirmed"].get(form.get("bos_confirmed", ""), 0)
    score += SCORING["valid_order_block"].get(form.get("valid_order_block", ""), 0)
    score += SCORING["fvg_confluence"].get(form.get("fvg_confluence", ""), 0)
    score += SCORING["session_alignment"].get(form.get("session_alignment", ""), 0)
    score += SCORING["ltf_confirmation"].get(form.get("ltf_confirmation", ""), 0)
    return score

def get_rating(score):
    if score >= 10:
        return "Elite Setup"
    elif score >= 7:
        return "Tradable Setup"
    else:
        return "Avoid"

def get_decision(score, ltf_confirmation):
    if score >= 10 and ltf_confirmation == "yes":
        return "Execute Trade (Instant Execution)"
    elif score >= 9 and ltf_confirmation == "no":
        return "Place Pending Order"
    elif score < 7:
        return "No Trade"
    else:
        return "Caution: Not Ideal Setup"

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/assess", methods=["POST"])
def assess():
    form = request.form

    required_fields = [
        "d1_trend", "liquidity_sweep", "bos_confirmed",
        "valid_order_block", "fvg_confluence", "session_alignment", "ltf_confirmation"
    ]
    for field in required_fields:
        if not form.get(field):
            return render_template("index.html", error="Please fill in all fields before submitting.")

    score = calculate_score(form)
    ltf_confirmation = form.get("ltf_confirmation", "no")
    rating = get_rating(score)
    decision = get_decision(score, ltf_confirmation)

    inputs = {
        "D1 Trend": form.get("d1_trend", "").replace("_", " ").title(),
        "Liquidity Sweep": form.get("liquidity_sweep", "").title(),
        "BOS Confirmed": form.get("bos_confirmed", "").upper(),
        "Valid Order Block": form.get("valid_order_block", "").upper(),
        "FVG Confluence": form.get("fvg_confluence", "").upper(),
        "Session Alignment": form.get("session_alignment", "").upper(),
        "LTF Confirmation (15m)": form.get("ltf_confirmation", "").upper(),
    }

    return render_template("result.html",
                           score=score,
                           rating=rating,
                           decision=decision,
                           inputs=inputs)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
