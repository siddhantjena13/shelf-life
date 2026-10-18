from fastapi.testclient import TestClient
import time

import readings
from main import app


def test_full_day_history_pages_keep_a_fixed_snapshot(tmp_path):
    c = client(tmp_path)
    now = int(time.time() * 1000)
    start = now - 24 * 3600_000 + 1000
    with readings._lock:
        db = readings._db()
        db.executemany(
            "INSERT INTO readings (device_id, sensor_id, temp_c, humidity, ts_ms) VALUES (?, ?, ?, ?, ?)",
            [(f"device-{i % 2}", ('top', 'bottom')[i % 2], 4, 70, start + (i // 2) * 3000) for i in range(57600)],
        )
        db.commit()
    page = c.get('/api/readings/history').json()
    ids = [row['id'] for row in page['readings']]
    assert page['hasMore']
    # New readings must not move the snapshot or get lost before live polling.
    new = c.post('/api/readings', json={'device_id': 'shelflife_01', 'temp_c': 4, 'humidity': 70}).json()
    while page['hasMore']:
        page = c.get('/api/readings/history', params={
            'after_id': page['nextAfterId'], 'until_id': page['untilId'], 'since_ms': page['sinceMs'],
        }).json()
        ids.extend(row['id'] for row in page['readings'])
    assert ids == list(range(1, 57601))
    assert [r['id'] for r in c.get('/api/readings', params={'after_id': page['untilId']}).json()] == [new['id']]


def client(tmp_path):
    readings.configure(str(tmp_path / "test.db"))
    return TestClient(app)


def test_post_and_list(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/readings", json={"device_id": "shelflife_01", "temp_c": 4.21, "humidity": 76.4})
    assert r.status_code == 200
    assert r.json()["sensor_id"] == "top"
    c.post("/api/readings", json={"device_id": "shelflife_02", "temp_c": 6.8, "humidity": 81})

    rows = c.get("/api/readings").json()
    assert [row["sensor_id"] for row in rows] == ["top", "bottom"]
    assert set(rows[0]) == {"id", "device_id", "sensor_id", "temp_c", "humidity", "door_open", "timestamp"}
    assert rows[0]["timestamp"].endswith("Z")

    newer = c.get(f"/api/readings?after_id={rows[0]['id']}").json()
    assert [row["device_id"] for row in newer] == ["shelflife_02"]


def test_unknown_device_rejected(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/readings", json={"device_id": "mystery", "temp_c": 4, "humidity": 50})
    assert r.status_code == 422


def test_explicit_zone_and_env_mapping(tmp_path, monkeypatch):
    c = client(tmp_path)
    assert c.post("/api/readings", json={"device_id": "x", "sensor_id": "mid", "temp_c": 3, "humidity": 60}).json()["sensor_id"] == "mid"
    monkeypatch.setenv("SHELFLIFE_DEVICE_ZONES", "fridge_a=bottom")
    assert c.post("/api/readings", json={"device_id": "fridge_a", "temp_c": 3, "humidity": 60}).json()["sensor_id"] == "bottom"


def test_devices_and_risk_accepts_live_rows(tmp_path):
    c = client(tmp_path)
    c.post("/api/readings", json={"device_id": "shelflife_01", "temp_c": 4, "humidity": 70})
    devices = c.get("/api/devices").json()
    assert devices[0]["device_id"] == "shelflife_01" and devices[0]["readings"] == 1

    # The dashboard forwards these rows to the risk engine unchanged.
    rows = c.get("/api/readings").json()
    r = c.post("/api/risk/assess", json={"readings": rows, "inventory": [], "now": rows[0]["timestamp"]})
    assert r.status_code == 200


def test_first_request_on_fresh_server_does_not_hang(tmp_path, monkeypatch):
    # Regression: the very first request opens the database while holding the lock.
    readings._conn = None
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.setenv("SHELFLIFE_DB", str(tmp_path / "fresh.db"))
    c = TestClient(app)
    assert c.post("/api/readings", json={"device_id": "shelflife_01", "temp_c": 4, "humidity": 70}).status_code == 200
