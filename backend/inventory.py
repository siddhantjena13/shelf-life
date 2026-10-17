"""Inventory endpoints: log food, re-check its freshness, and scan photos."""

import base64
import binascii
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

import vision
from risk.profiles import PROFILES

router = APIRouter(prefix="/api")

ProfileId = Literal[tuple(PROFILES)]
Zone = Literal["top", "mid", "bottom"]
Freshness = Literal["fresh", "good", "fair", "poor", "spoiled"]
DateKind = Literal["use_by", "best_by", "sell_by", "expires"]

SCAN_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SCAN_BYTES = 10 * 1024 * 1024
MAX_PHOTO_BYTES = 1536 * 1024
CLOSED_VISIBLE_DAYS = 30
CLOCK_SKEW = timedelta(minutes=5)

_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$")
_MAGIC = {
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Observation(ApiModel):
    """What a freshness check records. Shared by new items and re-logs."""
    freshness: Freshness | None = None
    freshness_note: str | None = Field(None, max_length=200)
    expires_on: date | None = None
    date_kind: DateKind | None = None
    photo: str | None = Field(None, description="data:image/...;base64 thumbnail")
    source: Literal["photo", "manual"] = "manual"
    confidence: float | None = Field(None, ge=0, le=1)


class ItemCreate(Observation):
    name: str = Field(min_length=1, max_length=80)
    profile: ProfileId
    zone: Zone = "mid"
    packaged: bool = False
    added_at: datetime


class ItemUpdate(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    profile: ProfileId | None = None
    zone: Zone | None = None
    packaged: bool | None = None
    added_at: datetime | None = None
    expires_on: date | None = None
    date_kind: DateKind | None = None
    state: Literal["active", "used", "tossed"] | None = None


NOT_NULLABLE = {"name", "profile", "zone", "packaged", "added_at", "state"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _utc(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def _new_id() -> str:
    return uuid.uuid4().hex


def _store(request: Request):
    return request.app.state.store


def _public_check(check: dict) -> dict:
    return {
        "id": check["id"],
        "at": _iso(check["at"]),
        "freshness": check.get("freshness"),
        "note": check.get("note"),
        "expiresOn": check.get("expires_on"),
        "dateKind": check.get("date_kind"),
        "source": check.get("source", "manual"),
        "photoId": check.get("photo_id"),
        "confidence": check.get("confidence"),
    }


def public_item(doc: dict) -> dict:
    return {
        "id": doc["_id"],
        "name": doc["name"],
        "profile": doc["profile"],
        "zone": doc["zone"],
        "packaged": doc["packaged"],
        "addedAt": _iso(doc["added_at"]),
        "expiresOn": doc.get("expires_on"),
        "dateKind": doc.get("date_kind"),
        "freshness": doc.get("freshness"),
        "freshnessNote": doc.get("freshness_note"),
        "photoId": doc.get("photo_id"),
        "lastCheckedAt": _iso(doc.get("last_checked_at")),
        "state": doc["state"],
        "closedAt": _iso(doc.get("closed_at")),
        "createdAt": _iso(doc["created_at"]),
        "updatedAt": _iso(doc["updated_at"]),
        "checks": [_public_check(c) for c in doc.get("checks", [])],
    }


def _decode_photo(data_url: str) -> tuple[bytes, str]:
    match = _DATA_URL.match(data_url.strip())
    if not match:
        raise HTTPException(422, "Photos must be a JPEG, PNG or WEBP data URL.")
    content_type, encoded = match.groups()
    try:
        data = base64.b64decode(re.sub(r"\s+", "", encoded), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(422, "The photo is not valid base64.") from exc
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "The saved photo must be 1.5 MB or smaller.")
    if not _MAGIC[content_type](data):
        raise HTTPException(422, "The photo's contents do not match its image type.")
    return data, content_type


async def _store_photo(request: Request, data_url: str | None, item_id: str) -> str | None:
    if not data_url:
        return None
    data, content_type = _decode_photo(data_url)
    photo_id = _new_id()
    await _store(request).save_photo({
        "_id": photo_id,
        "item_id": item_id,
        "content_type": content_type,
        "data": data,
        "created_at": _now(),
    })
    return photo_id


def _check_entry(obs: Observation, photo_id: str | None, at: datetime) -> dict | None:
    """A check is recorded only when it observed something."""
    if obs.freshness is None and obs.expires_on is None and photo_id is None and not obs.freshness_note:
        return None
    return {
        "id": _new_id(),
        "at": at,
        "freshness": obs.freshness,
        "note": obs.freshness_note,
        "expires_on": obs.expires_on.isoformat() if obs.expires_on else None,
        "date_kind": obs.date_kind if obs.expires_on else None,
        "source": obs.source,
        "photo_id": photo_id,
        "confidence": obs.confidence,
    }


def _not_future(value: datetime, field: str) -> datetime:
    value = _utc(value)
    if value > _now() + CLOCK_SKEW:
        raise HTTPException(422, f"{field} cannot be in the future.")
    return value


async def _get_or_404(request: Request, item_id: str) -> dict:
    item = await _store(request).get_item(item_id)
    if item is None:
        raise HTTPException(404, "That item is not in the inventory.")
    return item


@router.get("/inventory")
async def list_inventory(request: Request):
    """Active items, plus items used or tossed in the last 30 days."""
    since = _now() - timedelta(days=CLOSED_VISIBLE_DAYS)
    items = await _store(request).list_items(closed_since=since)
    return {"items": [public_item(item) for item in items]}


@router.post("/inventory", status_code=201)
async def create_item(request: Request, payload: ItemCreate):
    now = _now()
    item_id = _new_id()
    photo_id = await _store_photo(request, payload.photo, item_id)
    check = _check_entry(payload, photo_id, now)
    doc = {
        "_id": item_id,
        "name": payload.name.strip(),
        "profile": payload.profile,
        "zone": payload.zone,
        "packaged": payload.packaged,
        "added_at": _not_future(payload.added_at, "The date added"),
        "expires_on": payload.expires_on.isoformat() if payload.expires_on else None,
        "date_kind": payload.date_kind if payload.expires_on else None,
        "freshness": payload.freshness,
        "freshness_note": payload.freshness_note,
        "photo_id": photo_id,
        "last_checked_at": now if check else None,
        "checks": [check] if check else [],
        "state": "active",
        "closed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    return public_item(await _store(request).insert_item(doc))


@router.get("/inventory/{item_id}")
async def get_item(request: Request, item_id: str):
    return public_item(await _get_or_404(request, item_id))


@router.patch("/inventory/{item_id}")
async def update_item(request: Request, item_id: str, payload: ItemUpdate):
    data = payload.model_dump(exclude_unset=True)
    for field in NOT_NULLABLE & data.keys():
        if data[field] is None:
            raise HTTPException(422, f"{to_camel(field)} cannot be empty.")
    item = await _get_or_404(request, item_id)

    now = _now()
    changes: dict = {"updated_at": now}
    for field in ("profile", "zone", "packaged"):
        if field in data:
            changes[field] = data[field]
    if "name" in data:
        changes["name"] = data["name"].strip()
    if "added_at" in data:
        changes["added_at"] = _not_future(data["added_at"], "The date added")
    if "expires_on" in data:
        if data["expires_on"] is None:
            changes["expires_on"] = changes["date_kind"] = None
        else:
            changes["expires_on"] = data["expires_on"].isoformat()
            changes["date_kind"] = data.get("date_kind") or item.get("date_kind") or "expires"
    elif "date_kind" in data and item.get("expires_on"):
        changes["date_kind"] = data["date_kind"]
    if "state" in data and data["state"] != item["state"]:
        changes["state"] = data["state"]
        changes["closed_at"] = None if data["state"] == "active" else now

    updated = await _store(request).update_item(item_id, changes)
    if updated is None:
        raise HTTPException(404, "That item is not in the inventory.")
    return public_item(updated)


@router.delete("/inventory/{item_id}", status_code=204)
async def delete_item(request: Request, item_id: str):
    if not await _store(request).delete_item(item_id):
        raise HTTPException(404, "That item is not in the inventory.")
    return Response(status_code=204)


@router.post("/inventory/{item_id}/checks")
async def add_check(request: Request, item_id: str, payload: Observation):
    """Re-log an item: record how it looks now and update its current state."""
    await _get_or_404(request, item_id)
    now = _now()
    photo_id = await _store_photo(request, payload.photo, item_id)
    check = _check_entry(payload, photo_id, now)
    if check is None:
        raise HTTPException(422, "Add a photo, a freshness rating, a note or a printed date to log a check.")

    changes: dict = {"updated_at": now, "last_checked_at": now}
    if payload.freshness is not None:
        changes["freshness"] = payload.freshness
        changes["freshness_note"] = payload.freshness_note
    if payload.expires_on is not None:
        changes["expires_on"] = payload.expires_on.isoformat()
        changes["date_kind"] = payload.date_kind or "expires"
    if photo_id is not None:
        changes["photo_id"] = photo_id

    updated = await _store(request).update_item(item_id, changes, check=check)
    if updated is None:
        raise HTTPException(404, "That item is not in the inventory.")
    return public_item(updated)


async def _read_scan(image: UploadFile) -> bytes:
    if image.content_type not in SCAN_TYPES:
        raise HTTPException(415, "Use a JPEG, PNG or WEBP photo.")
    data = await image.read(MAX_SCAN_BYTES + 1)
    if not data:
        raise HTTPException(400, "The photo is empty.")
    if len(data) > MAX_SCAN_BYTES:
        raise HTTPException(413, "The photo must be 10 MB or smaller.")
    return data


def _today(value: str | None) -> date:
    """The user's local date, so 'today' in prompts matches their calendar."""
    try:
        return date.fromisoformat(value) if value else date.today()
    except ValueError:
        return date.today()


@router.post("/inventory/scan")
async def scan_new(image: UploadFile = File(...), today: str | None = Form(None)):
    """Suggest items to log from a photo. Nothing is saved."""
    data = await _read_scan(image)
    try:
        items = await vision.identify(data, image.content_type, _today(today))
    except vision.VisionError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    return {"items": items, "model": vision.model_name()}


@router.post("/inventory/{item_id}/scan")
async def scan_existing(request: Request, item_id: str, image: UploadFile = File(...), today: str | None = Form(None)):
    """Suggest a freshness check for an existing item from a new photo. Nothing is saved."""
    item = await _get_or_404(request, item_id)
    data = await _read_scan(image)
    try:
        result = await vision.inspect(data, image.content_type, item["name"], item["profile"], _today(today))
    except vision.VisionError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    return {**result, "model": vision.model_name()}


@router.get("/photos/{photo_id}")
async def get_photo(request: Request, photo_id: str):
    photo = await _store(request).get_photo(photo_id)
    if photo is None:
        raise HTTPException(404, "Photo not found.")
    return Response(
        content=bytes(photo["data"]),
        media_type=photo["content_type"],
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )
