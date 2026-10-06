import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
IS_POSTGRES = bool(DB_URL)
SQLITE_PATH = os.environ.get("SQLITE_PATH", "/tmp/filament_studio_v4.db")

KEY_PATTERN = re.compile(r"^KA-[A-Z0-9]{4}-[A-Z0-9]{4}$")
DEMO_RESET_INTERVAL_SEC = 1800  # Автосброс песочницы каждые 30 минут

DEMO_GCODES = {
    "petg_corner": {
        "filename": "AD5M_Enclosure_Corner_v2.gx",
        "format": "GX (FlashForge Binary)",
        "weight_g": 64.8,
        "length_m": 21.35,
        "time_str": "01h 42m",
        "time_hours": 1.7,
        "filament_type": "PETG",
        "layer_height": 0.2,
        "thumbnail": None
    },
    "tpu_damper": {
        "filename": "AD5M_AntiVibro_Foot_TPU95A.gcode",
        "format": "G-CODE (Orca Slicer)",
        "weight_g": 18.4,
        "length_m": 6.12,
        "time_str": "00h 48m",
        "time_hours": 0.8,
        "filament_type": "TPU 95A",
        "layer_height": 0.2,
        "thumbnail": None
    }
}

DEFAULT_DEMO_SPOOLS = [
    ("DemoSpool", "PETG", "Industrial White", "#e4e4e7", 1000, 660, 1200),
    ("DemoSpool", "PLA+", "Crimson Red", "#dc2626", 1000, 320, 1350),
    ("DemoSpool", "TPU 95A", "Cobalt Blue", "#2563eb", 500, 450, 1400),
]

DEFAULT_USER_SPOOLS = [
    ("BestFilament", "PETG", "Carbon Black", "#27272a", 1000, 680, 1290),
    ("eSUN", "PLA+", "Signal Orange", "#ea580c", 1000, 845, 1450),
    ("REC", "TPU 95A", "Cobalt Blue", "#2563eb", 500, 410, 1350),
    ("Eryone", "ASA", "Titanium Grey", "#71717a", 1000, 125, 1890),
]
