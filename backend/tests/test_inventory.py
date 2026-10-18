import base64
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import vision
from main import app

# Smallest valid JPEG header is enough: photos are checked by magic bytes only.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PHOTO = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()
TODAY = date(2026, 10, 17)


@pytest.fixture
def db_path(monkeypatch, tmp_path):
    # Never touch the real database or the real Perceptron API from tests,
    # even when backend/.env configures them.
    for name in ("MONGODB_URI", "PERCEPTRON_API_KEY", "PERCEPTRON_MODEL", "PERCEPTRON_REASONING"):
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / "inventory.db"
    monkeypatch.setenv("SQLITE_PATH", str(path))
    return path


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def hours_ago(h):
    return (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()


def new_item(client, **overrides):
    body = {"name": "Whole milk", "profile": "dairy", "zone": "top", "addedAt": hours_ago(2), **overrides}
    response = client.post("/api/inventory", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def stub_perceptron(monkeypatch, answer):
    sent = {}

    async def fake_complete(body, api_key):
        sent["body"] = body
        return {"choices": [{"message": {"content": answer if isinstance(answer, str) else json.dumps(answer)}}]}

    monkeypatch.setenv("PERCEPTRON_API_KEY", "test-key")
    monkeypatch.setattr(vision, "_complete", fake_complete)
    return sent


def test_health_reports_sqlite_store(client):
    body = client.get("/api/health").json()
    assert body["database"] == "sqlite" and body["databaseReachable"] is True
    assert body["vision"] is False
    assert body["visionModel"] == "perceptron-mk1.5"


def test_inventory_survives_a_restart(db_path):
    with TestClient(app) as first:
        item = new_item(first, photo=PHOTO, freshness="good")
        first.post(f"/api/inventory/{item['id']}/checks", json={"freshness": "fair"})
    with TestClient(app) as second:
        [saved] = second.get("/api/inventory").json()["items"]
        assert saved["id"] == item["id"] and saved["freshness"] == "fair"
        assert [c["freshness"] for c in saved["checks"]] == ["good", "fair"]
        assert second.get(f"/api/photos/{item['photoId']}").content == JPEG


def test_create_and_list_item_with_photo_and_first_check(client):
    item = new_item(client, photo=PHOTO, source="photo", freshness="fresh", expiresOn="2026-10-24", dateKind="best_by")
    assert item["freshness"] == "fresh"
    assert item["expiresOn"] == "2026-10-24"
    assert item["photoId"]
    assert len(item["checks"]) == 1 and item["checks"][0]["source"] == "photo"

    listed = client.get("/api/inventory").json()["items"]
    assert [i["id"] for i in listed] == [item["id"]]

    photo = client.get(f"/api/photos/{item['photoId']}")
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    assert photo.content == JPEG


def test_manual_item_without_observation_has_no_checks(client):
    item = new_item(client)
    assert item["checks"] == []
    assert item["lastCheckedAt"] is None


def test_rejects_unknown_profile_future_date_and_bad_photo(client):
    base = {"name": "X", "zone": "mid", "addedAt": hours_ago(1)}
    assert client.post("/api/inventory", json={**base, "profile": "candy"}).status_code == 422
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert client.post("/api/inventory", json={**base, "profile": "other", "addedAt": future}).status_code == 422
    fake_png = "data:image/png;base64," + base64.b64encode(JPEG).decode()
    assert client.post("/api/inventory", json={**base, "profile": "other", "photo": fake_png}).status_code == 422


def test_relog_appends_check_and_updates_current_state(client):
    item = new_item(client, freshness="fresh")
    response = client.post(f"/api/inventory/{item['id']}/checks", json={
        "freshness": "fair", "freshnessNote": "Edges wilting", "photo": PHOTO, "source": "photo",
        "expiresOn": "2026-10-20", "dateKind": "use_by",
    })
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["freshness"] == "fair"
    assert updated["freshnessNote"] == "Edges wilting"
    assert updated["expiresOn"] == "2026-10-20" and updated["dateKind"] == "use_by"
    assert [c["freshness"] for c in updated["checks"]] == ["fresh", "fair"]
    assert updated["photoId"] == updated["checks"][-1]["photoId"]


def test_empty_relog_is_rejected(client):
    item = new_item(client)
    assert client.post(f"/api/inventory/{item['id']}/checks", json={}).status_code == 422


def test_patch_edits_fields_and_clears_date(client):
    item = new_item(client, expiresOn="2026-10-24", dateKind="best_by")
    updated = client.patch(f"/api/inventory/{item['id']}", json={"name": "Oat milk", "zone": "bottom", "expiresOn": None}).json()
    assert updated["name"] == "Oat milk" and updated["zone"] == "bottom"
    assert updated["expiresOn"] is None and updated["dateKind"] is None
    assert client.patch(f"/api/inventory/{item['id']}", json={"name": None}).status_code == 422


def test_used_items_stay_listed_as_closed_and_can_be_restored(client):
    item = new_item(client)
    used = client.patch(f"/api/inventory/{item['id']}", json={"state": "used"}).json()
    assert used["state"] == "used" and used["closedAt"]
    assert client.get("/api/inventory").json()["items"][0]["state"] == "used"
    restored = client.patch(f"/api/inventory/{item['id']}", json={"state": "active"}).json()
    assert restored["state"] == "active" and restored["closedAt"] is None


def test_delete_removes_item_and_its_photos(client):
    item = new_item(client, photo=PHOTO)
    assert client.delete(f"/api/inventory/{item['id']}").status_code == 204
    assert client.get(f"/api/inventory/{item['id']}").status_code == 404
    assert client.get(f"/api/photos/{item['photoId']}").status_code == 404


def test_scan_without_api_key_explains_setup(client):
    response = client.post("/api/inventory/scan", files={"image": ("a.jpg", JPEG, "image/jpeg")})
    assert response.status_code == 503
    assert "PERCEPTRON_API_KEY" in response.json()["detail"]


def test_scan_rejects_unsupported_type(client):
    response = client.post("/api/inventory/scan", files={"image": ("a.gif", b"GIF89a", "image/gif")})
    assert response.status_code == 415


def test_scan_new_normalizes_model_output(client, monkeypatch):
    sent = stub_perceptron(monkeypatch, {"items": [
        {"name": "  Baby   spinach ", "profile": "greens", "confidence": 1.4, "packaged": True,
         "freshness": "good", "freshness_note": "Leaves crisp", "date_text": "BEST BY OCT 22",
         "expires_on": "2026-10-22", "date_kind": "best_by"},
        {"name": "baby spinach", "profile": "greens", "confidence": 0.5, "packaged": False,
         "freshness": "unknown", "freshness_note": "", "date_text": "", "expires_on": "", "date_kind": "none"},
        {"name": "Mystery jar", "profile": "condiments", "confidence": 0.3, "packaged": True,
         "freshness": "unknown", "freshness_note": "", "date_text": "13/45", "expires_on": "2026-13-45", "date_kind": "none"},
    ]})
    response = client.post(
        "/api/inventory/scan",
        files={"image": ("a.jpg", JPEG, "image/jpeg")},
        data={"today": TODAY.isoformat()},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [i["name"] for i in items] == ["Baby spinach", "Mystery jar"]
    spinach, jar = items
    assert spinach["confidence"] == 1.0 and spinach["packaged"] is True
    assert spinach["freshness"] == "good" and spinach["expiresOn"] == "2026-10-22" and spinach["dateKind"] == "best_by"
    assert jar["profile"] == "other" and jar["freshness"] is None
    assert jar["expiresOn"] is None and jar["dateText"] == "13/45"

    body = sent["body"]
    assert body["model"] == "perceptron-mk1.5"
    assert body["reasoning_effort"] == "none"
    assert body["response_format"]["type"] == "json_schema"
    assert body["messages"][0]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "Today is 2026-10-17" in body["messages"][0]["content"][1]["text"]


def test_scan_existing_item_returns_suggested_check(client, monkeypatch):
    item = new_item(client, name="Strawberries", profile="berries")
    sent = stub_perceptron(monkeypatch, "<think>looking</think>```json\n" + json.dumps({
        "shows_item": True, "confidence": 0.8, "freshness": "poor", "freshness_note": "Soft spots and a little mold",
        "date_text": "", "expires_on": "", "date_kind": "none",
    }) + "\n```")
    response = client.post(f"/api/inventory/{item['id']}/scan", files={"image": ("a.jpg", JPEG, "image/jpeg")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["showsItem"] is True and result["freshness"] == "poor"
    assert result["expiresOn"] is None
    assert '"Strawberries"' in sent["body"]["messages"][0]["content"][1]["text"]
    # Scanning suggests; it never saves.
    assert client.get(f"/api/inventory/{item['id']}").json()["checks"] == []


def test_implausible_printed_dates_are_dropped():
    raw = {"freshness": "good", "expires_on": "1999-01-01", "date_kind": "use_by"}
    assert vision.normalize_inspected(raw, TODAY)["expiresOn"] is None
    assert vision.normalize_inspected({**raw, "expires_on": "2026-10-20"}, TODAY)["dateKind"] == "use_by"


def test_risk_assessment_uses_dates_and_checks(client):
    now = datetime.now(timezone.utc)
    readings = [
        {"sensor_id": "mid", "temp_c": 4.0, "humidity": 70, "timestamp": (now - timedelta(minutes=m)).isoformat()}
        for m in range(0, 12 * 60, 5)
    ]
    base = {"name": "Spinach", "profile": "greens", "zone": "mid", "packaged": True,
            "added_at": (now - timedelta(hours=12)).isoformat()}
    payload = {
        "now": now.isoformat(),
        "readings": readings,
        "inventory": [
            {**base, "id": "plain"},
            {**base, "id": "checked", "checks": [
                {"at": (now - timedelta(minutes=5)).isoformat(), "freshness": "poor", "source": "photo", "confidence": 0.9},
            ]},
            {**base, "id": "dated", "expires_at": (now + timedelta(days=6)).isoformat(), "date_kind": "best_by"},
        ],
    }
    response = client.post("/api/risk/assess", json=payload)
    assert response.status_code == 200, response.text
    items = {i["id"]: i for i in response.json()["items"]}
    plain, checked, dated = items["plain"], items["checked"], items["dated"]
    assert plain["remainingLow"] <= plain["remainingHours"] <= plain["remainingHigh"]
    assert plain["baseline"]["source"] == "foodkeeper" and dated["baseline"]["source"] == "date"
    assert checked["checksUsed"] == 1 and checked["remainingHours"] < plain["remainingHours"]
    assert dated["remainingHours"] > plain["remainingHours"]
    assert plain["survival"][0][0] == 0 and 0 <= plain["survival"][-1][1] <= plain["survival"][0][1]
    assert plain["waterLimitPct"] == 4.0
