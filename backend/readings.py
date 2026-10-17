"""Live sensor readings from the ESP32 devices, stored in SQLite.

The ESP32 posts one reading every few seconds:
    POST /api/readings   {"device_id": "shelflife_01", "temp_c": 4.2, "humidity": 76.1}

The dashboard polls for readings it has not seen yet:
    GET /api/readings?hours=24        history on page load
    GET /api/readings?after_id=123    only readings newer than id 123

Readings come back in the shape the dashboard already uses:
    {id, device_id, sensor_id, temp_c, humidity, door_open, timestamp}
where sensor_id is the fridge zone ("top", "mid", "bottom").

GET /api/devices lists every device that has reported, which is a quick way to
check from a browser that an ESP32 is reaching the laptop.
"""

import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

ZONES = {"top", "mid", "bottom"}

# Which fridge zone each physical device reports for. Override without editing
# code: SHELFLIFE_DEVICE_ZONES="shelflife_01=top,shelflife_02=bottom"
DEFAULT_DEVICE_ZONES = {"shelflife_01": "top", "shelflife_02": "bottom"}

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shelflife.db")
MAX_ROWS_PER_REQUEST = 20_000

router = APIRouter(prefix="/api", tags=["readings"])

_lock = threading.RLock()  # re-entrant: _db() may call configure() while the lock is held
_conn: sqlite3.Connection | None = None


def _device_zones() -> dict[str, str]:
    raw = os.getenv("SHELFLIFE_DEVICE_ZONES", "").strip()
    if not raw:
        return dict(DEFAULT_DEVICE_ZONES)
    zones = {}
    for pair in raw.split(","):
        device, _, zone = pair.partition("=")
        if device.strip() and zone.strip() in ZONES:
            zones[device.strip()] = zone.strip()
    return zones


def configure(db_path: str | None = None) -> None:
    """Open (or create) the database. Called on first use; tests call it directly."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        path = db_path or os.getenv("SHELFLIFE_DB", DEFAULT_DB_PATH)
        _conn = sqlite3.connect(path, check_same_thread=False)
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS readings (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   device_id TEXT NOT NULL,
                   sensor_id TEXT NOT NULL,
                   temp_c REAL NOT NULL,
                   humidity REAL NOT NULL,
                   door_open INTEGER NOT NULL DEFAULT 0,
                   ts_ms INTEGER NOT NULL
               )"""
        )
        _conn.execute("CREATE INDEX IF NOT EXISTS readings_ts ON readings (ts_ms)")
        _conn.commit()


def _db() -> sqlite3.Connection:
    if _conn is None:
        configure()
    return _conn


def _iso(ts_ms: int) -> str:
    # Same format JavaScript's toISOString() produces, so the dashboard can
    # sort timestamps as strings.
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _row(row: tuple) -> dict:
    rid, device_id, sensor_id, temp_c, humidity, door_open, ts_ms = row
    return {
        "id": rid,
        "device_id": device_id,
        "sensor_id": sensor_id,
        "temp_c": temp_c,
        "humidity": humidity,
        "door_open": bool(door_open),
        "timestamp": _iso(ts_ms),
    }


class ReadingIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=40)
    temp_c: float = Field(ge=-40, le=125)
    humidity: float = Field(ge=0, le=100)
    # Optional: send a zone directly instead of relying on the device mapping.
    sensor_id: str | None = None
    door_open: bool = False


@router.post("/readings")
def add_reading(reading: ReadingIn):
    zone = reading.sensor_id if reading.sensor_id in ZONES else _device_zones().get(reading.device_id)
    if zone is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown device '{reading.device_id}'. Map it to a zone with SHELFLIFE_DEVICE_ZONES "
            f"or send sensor_id as one of {sorted(ZONES)}.",
        )
    ts_ms = int(time.time() * 1000)  # the backend stamps the time, so the ESP32 needs no clock
    with _lock:
        cur = _db().execute(
            "INSERT INTO readings (device_id, sensor_id, temp_c, humidity, door_open, ts_ms) VALUES (?, ?, ?, ?, ?, ?)",
            (reading.device_id, zone, round(reading.temp_c, 2), round(reading.humidity, 2), int(reading.door_open), ts_ms),
        )
        _db().commit()
    return {"ok": True, "id": cur.lastrowid, "sensor_id": zone, "timestamp": _iso(ts_ms)}


@router.get("/readings")
def list_readings(
    after_id: int | None = Query(default=None, ge=0, description="Only readings with a larger id"),
    hours: float = Query(default=24, gt=0, le=24 * 7, description="History window when after_id is not given"),
):
    with _lock:
        if after_id is not None:
            rows = _db().execute(
                "SELECT id, device_id, sensor_id, temp_c, humidity, door_open, ts_ms FROM readings "
                "WHERE id > ? ORDER BY id LIMIT ?",
                (after_id, MAX_ROWS_PER_REQUEST),
            ).fetchall()
        else:
            since = int((time.time() - hours * 3600) * 1000)
            rows = _db().execute(
                "SELECT id, device_id, sensor_id, temp_c, humidity, door_open, ts_ms FROM ("
                "  SELECT * FROM readings WHERE ts_ms >= ? ORDER BY id DESC LIMIT ?"
                ") ORDER BY id",
                (since, MAX_ROWS_PER_REQUEST),
            ).fetchall()
    return [_row(r) for r in rows]


@router.get("/devices")
def list_devices():
    with _lock:
        rows = _db().execute(
            "SELECT device_id, sensor_id, COUNT(*), MAX(ts_ms) FROM readings GROUP BY device_id, sensor_id ORDER BY device_id"
        ).fetchall()
    now_ms = int(time.time() * 1000)
    return [
        {
            "device_id": device_id,
            "sensor_id": sensor_id,
            "readings": count,
            "last_seen": _iso(last_ms),
            "seconds_ago": round((now_ms - last_ms) / 1000, 1),
        }
        for device_id, sensor_id, count, last_ms in rows
    ]
