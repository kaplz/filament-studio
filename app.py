import os
import secrets
from datetime import datetime
from flask import Flask, render_template, request, jsonify

from config import BASE_DIR, KEY_PATTERN, DEMO_GCODES, DEFAULT_USER_SPOOLS
from db import db_query, init_db, reset_demo_sandbox, check_and_maintain_demo

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)

try:
    init_db()
except Exception as e:
    print("DB Init warning:", e)


def fallback_dash(text):
    t = str(text or "").strip()
    return t[:40] if t else "-"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/key/generate", methods=["POST"])
def generate_key():
    alphabet = "0123456789ABCDEF"
    while True:
        part1 = "".join(secrets.choice(alphabet) for _ in range(4))
        part2 = "".join(secrets.choice(alphabet) for _ in range(4))
        new_key = f"KA-{part1}-{part2}"
        exists = db_query("SELECT key_id FROM workspaces WHERE key_id = ?", (new_key,), fetch=True)
        if not exists:
            break

    db_query("INSERT INTO workspaces (key_id, created_at) VALUES (?, ?)",
             (new_key, datetime.now().strftime("%Y-%m-%d %H:%M")))

    for s in DEFAULT_USER_SPOOLS:
        db_query("""
            INSERT INTO spools (workspace, brand, material, color_name, color_hex, initial_weight_g, remaining_weight_g, price_rub)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_key, s[0], s[1], s[2], s[3], s[4], s[5], s[6]))

    return jsonify({"status": "success", "key": new_key})


@app.route("/api/key/login", methods=["POST"])
def login_key():
    data = request.json or {}
    key = str(data.get("key", "")).strip().upper()

    if not KEY_PATTERN.match(key):
        return jsonify({
            "status": "error",
            "title": "НЕВЕРНЫЙ ФОРМАТ КЛЮЧА",
            "message": "Ключ должен строго соответствовать формату KA-****-****."
        }), 400

    exists = db_query("SELECT key_id FROM workspaces WHERE key_id = ?", (key,), fetch=True)
    if not exists:
        return jsonify({
            "status": "error",
            "title": "КЛЮЧ НЕ НАЙДЕН",
            "message": "Указанный ключ не существует в базе данных. Проверьте правильность ввода или сгенерируйте новый ключ."
        }), 404

    return jsonify({"status": "success", "key": key})


@app.route("/api/demo/reset", methods=["POST"])
def api_reset_demo():
    reset_demo_sandbox()
    return jsonify({"status": "success"})


@app.route("/api/state", methods=["GET"])
def get_state():
    ws = request.args.get("workspace", "demo").strip().upper() or "DEMO"
    if ws == "DEMO":
        ws = "demo"
        check_and_maintain_demo()
    else:
        exists = db_query("SELECT key_id FROM workspaces WHERE key_id = ?", (ws,), fetch=True)
        if not exists:
            ws = "demo"

    spools = db_query("SELECT * FROM spools WHERE workspace = ? ORDER BY id DESC", (ws,), fetch=True)
    history = db_query("""
        SELECT h.*, s.brand, s.material, s.color_name
        FROM print_history h
        LEFT JOIN spools s ON h.spool_id = s.id
        WHERE h.workspace = ?
        ORDER BY h.id DESC LIMIT 20
    """, (ws,), fetch=True)
    return jsonify({"spools": spools, "history": history, "workspace": ws})


@app.route("/api/demo_gcode/<demo_key>", methods=["GET"])
def get_demo_gcode(demo_key):
    if demo_key in DEMO_GCODES:
        return jsonify({"status": "success", "data": DEMO_GCODES[demo_key]})
    return jsonify({"status": "error", "title": "ОШИБКА ФАЙЛА", "message": "Пример не найден"}), 404


@app.route("/api/spools/add", methods=["POST"])
def add_spool():
    d = request.json or {}
    ws = d.get("workspace", "demo").strip()
    if ws != "demo":
        ws = ws.upper()

    brand = fallback_dash(d.get("brand"))
    color_name = fallback_dash(d.get("color_name"))
    material = fallback_dash(d.get("material"))

    try:
        init_w = round(float(d.get("initial_weight_g", 1000)), 1)
        rem_w = round(float(d.get("remaining_weight_g", 1000)), 1)
        price = round(float(d.get("price_rub", 1300)), 1)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "title": "ОШИБКА ФОРМАТА ЧИСЕЛ", "message": "Вес и стоимость должны быть числами."}), 400

    if init_w < 50 or init_w > 10000:
        return jsonify({"status": "error", "title": "НЕВЕРНАЯ ЕМКОСТЬ", "message": "Емкость катушки должна быть от 50 до 10 000 г."}), 400
    if rem_w < 0 or rem_w > init_w:
        return jsonify({"status": "error", "title": "НЕВЕРНЫЙ ОСТАТОК", "message": f"Остаток должен быть от 0 до {init_w} г."}), 400
    if price < 0 or price > 1000000 or init_w != init_w or price != price:
        return jsonify({"status": "error", "title": "НЕВЕРНАЯ ЦЕНА", "message": "Цена катушки должна быть от 0 до 1 000 000 RUB."}), 400

    db_query("""
        INSERT INTO spools (workspace, brand, material, color_name, color_hex, initial_weight_g, remaining_weight_g, price_rub)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (ws, brand, material, color_name, d.get("color_hex", "#27272a"), init_w, rem_w, price))
    return jsonify({"status": "success"})


@app.route("/api/spools/update_weight", methods=["POST"])
def update_weight():
    d = request.json or {}
    ws = d.get("workspace", "demo").strip()
    if ws != "demo":
        ws = ws.upper()

    spool_id = int(d.get("spool_id", 0))
    rows = db_query("SELECT initial_weight_g FROM spools WHERE id = ? AND workspace = ?", (spool_id, ws), fetch=True)
    if not rows:
        return jsonify({"status": "error", "title": "КАТУШКА НЕ НАЙДЕНА", "message": "Выбранная катушка отсутствует."}), 404

    max_w = float(rows[0]["initial_weight_g"])
    new_w = max(0.0, min(max_w, round(float(d.get("remaining_weight_g", 0)), 1)))
    db_query("UPDATE spools SET remaining_weight_g = ? WHERE id = ? AND workspace = ?", (new_w, spool_id, ws))
    return jsonify({"status": "success"})


@app.route("/api/spools/delete/<int:spool_id>", methods=["POST"])
def delete_spool(spool_id):
    d = request.json or {}
    ws = d.get("workspace", "demo").strip()
    if ws != "demo":
        ws = ws.upper()
    db_query("DELETE FROM spools WHERE id = ? AND workspace = ?", (spool_id, ws))
    return jsonify({"status": "success"})


@app.route("/api/deduct", methods=["POST"])
def deduct():
    d = request.json or {}
    ws = d.get("workspace", "demo").strip()
    if ws != "demo":
        ws = ws.upper()

    spool_id = int(d.get("spool_id", 0))
    weight_used = round(float(d.get("weight_used_g", 0)), 1)
    is_failed = bool(d.get("is_failed", False))
    raw_name = fallback_dash(d.get("part_name"))
    part_name = f"[БРАК] {raw_name}" if is_failed else raw_name
    cost_rub = float(d.get("cost_rub", 0))

    if weight_used <= 0:
        return jsonify({"status": "error", "title": "НЕВЕРНАЯ МАССА", "message": "Масса для списания должна быть больше 0 г."}), 400

    rows = db_query("SELECT remaining_weight_g, initial_weight_g FROM spools WHERE id = ? AND workspace = ?", (spool_id, ws), fetch=True)
    if not rows:
        return jsonify({"status": "error", "title": "КАТУШКА НЕ НАЙДЕНА", "message": "Катушка не найдена на складе."}), 404

    rem = float(rows[0]["remaining_weight_g"])
    if rem <= 0:
        return jsonify({"status": "error", "title": "КАТУШКА ПУСТА", "message": "На выбранной катушке 0 г пластика. Списание невозможно."}), 400

    if weight_used > rem:
        deficit = round(weight_used - rem, 1)
        return jsonify({
            "status": "error",
            "title": "НЕДОСТАТОЧНО ПЛАСТИКА",
            "message": f"На катушке осталось всего {rem} г, а требуется списать {weight_used} г (не хватает {deficit} г)."
        }), 400

    new_rem = round(rem - weight_used, 1)
    db_query("UPDATE spools SET remaining_weight_g = ? WHERE id = ?", (new_rem, spool_id))
    db_query("""
        INSERT INTO print_history (workspace, spool_id, part_name, weight_used_g, cost_rub, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (ws, spool_id, part_name, weight_used, round(cost_rub, 1), datetime.now().strftime("%d.%m %H:%M")))
    return jsonify({"status": "success"})


@app.route("/api/history/undo/<int:hist_id>", methods=["POST"])
def undo_history(hist_id):
    d = request.json or {}
    ws = d.get("workspace", "demo").strip()
    if ws != "demo":
        ws = ws.upper()
    rows = db_query("SELECT * FROM print_history WHERE id = ? AND workspace = ?", (hist_id, ws), fetch=True)
    if rows:
        h = rows[0]
        spool_check = db_query("SELECT id, remaining_weight_g, initial_weight_g FROM spools WHERE id = ?", (h["spool_id"],), fetch=True)
        if spool_check:
            s = spool_check[0]
            restored = min(float(s["initial_weight_g"]), round(float(s["remaining_weight_g"]) + float(h["weight_used_g"]), 1))
            db_query("UPDATE spools SET remaining_weight_g = ? WHERE id = ?", (restored, h["spool_id"]))
        db_query("DELETE FROM print_history WHERE id = ?", (hist_id,))
    return jsonify({"status": "success"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
