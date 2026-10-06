import time
import sqlite3
from config import DB_URL, IS_POSTGRES, SQLITE_PATH, DEFAULT_DEMO_SPOOLS, DEMO_RESET_INTERVAL_SEC

if IS_POSTGRES:
    import psycopg2
    from psycopg2.extras import RealDictCursor

LAST_DEMO_RESET = time.time()


def db_query(sql, params=(), fetch=False):
    if IS_POSTGRES:
        sql_pg = sql.replace("?", "%s")
        conn = psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(sql_pg, params)
                    if fetch:
                        return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                cur = conn.execute(sql, params)
                if fetch:
                    return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
    return []


def reset_demo_sandbox():
    global LAST_DEMO_RESET
    db_query("DELETE FROM spools WHERE workspace = 'demo'")
    db_query("DELETE FROM print_history WHERE workspace = 'demo'")
    for s in DEFAULT_DEMO_SPOOLS:
        db_query("""
            INSERT INTO spools (workspace, brand, material, color_name, color_hex, initial_weight_g, remaining_weight_g, price_rub)
            VALUES ('demo', ?, ?, ?, ?, ?, ?, ?)
        """, s)
    LAST_DEMO_RESET = time.time()


def check_and_maintain_demo():
    spools_cnt = db_query("SELECT COUNT(*) as cnt FROM spools WHERE workspace = 'demo'", fetch=True)
    c = spools_cnt[0]["cnt"] if spools_cnt else 0
    if c == 0 or c > 9 or (time.time() - LAST_DEMO_RESET > DEMO_RESET_INTERVAL_SEC):
        reset_demo_sandbox()


def init_db():
    id_type = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    db_query("""
        CREATE TABLE IF NOT EXISTS workspaces (
            key_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
        )
    """)
    db_query(f"""
        CREATE TABLE IF NOT EXISTS spools (
            id {id_type},
            workspace TEXT NOT NULL DEFAULT 'demo',
            brand TEXT NOT NULL,
            material TEXT NOT NULL,
            color_name TEXT NOT NULL,
            color_hex TEXT NOT NULL,
            initial_weight_g REAL NOT NULL,
            remaining_weight_g REAL NOT NULL,
            price_rub REAL NOT NULL
        )
    """)
    db_query(f"""
        CREATE TABLE IF NOT EXISTS print_history (
            id {id_type},
            workspace TEXT NOT NULL DEFAULT 'demo',
            spool_id INTEGER NOT NULL,
            part_name TEXT NOT NULL,
            weight_used_g REAL NOT NULL,
            cost_rub REAL NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    cnt = db_query("SELECT COUNT(*) as cnt FROM spools WHERE workspace = 'demo'", fetch=True)
    if cnt and cnt[0]["cnt"] == 0:
        reset_demo_sandbox()
