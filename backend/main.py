"""HTTP endpoints for the ShelfSense dashboard."""

import json
import os
import re
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from risk import Item, Reading, assess, recommend
from risk.profiles import PROFILES

PERCEPTRON_URL = "https://perceptron.cloud/api/v1/vision"
MODEL = os.getenv("PERCEPTRON_MODEL", "perceptron-mk1")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_PROFILES = set(PROFILES)
ALLOWED_ZONES = {"top", "mid", "bottom"}

app = FastAPI(title="ShelfSense API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ReadingInput(BaseModel):
    sensor_id: str = Field(min_length=1, max_length=40)
    temp_c: float = Field(ge=-50, le=80)
    humidity: float = Field(ge=0, le=100)
    timestamp: datetime


class InventoryInput(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    profile: str
    zone: str
    added_at: datetime
    packaged: bool = False


class RiskAssessmentInput(BaseModel):
    readings: list[ReadingInput] = Field(max_length=50000)
    inventory: list[InventoryInput] = Field(max_length=500)
    now: datetime


def _epoch(value: datetime) -> float:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _extract_json(text: str) -> object:
    """Accept a JSON response with or without a surrounding Markdown fence."""
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", stripped, re.IGNORECASE | re.DOTALL)
    candidate = fenced.group(1) if fenced else stripped
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise HTTPException(status_code=502, detail="The vision model returned an unreadable result. Try another photo.")


def _normalize_items(payload: object) -> list[dict]:
    raw_items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=502, detail="The vision model did not return an item list.")

    result = []
    seen = set()
    for raw in raw_items[:30]:
        if not isinstance(raw, dict):
            continue
        name = re.sub(r"\s+", " ", str(raw.get("name", ""))).strip()[:80]
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        profile = str(raw.get("profile", "other")).lower()
        if profile not in ALLOWED_PROFILES:
            profile = "other"
        try:
            confidence = max(0.0, min(1.0, float(raw.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        result.append({"name": name, "profile": profile, "confidence": confidence})
    return result


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/risk/assess")
async def assess_inventory(payload: RiskAssessmentInput):
    if any(item.profile not in PROFILES for item in payload.inventory):
        raise HTTPException(status_code=422, detail="Inventory contains an unsupported food profile.")
    if any(item.zone not in ALLOWED_ZONES for item in payload.inventory):
        raise HTTPException(status_code=422, detail="Inventory contains an unsupported storage zone.")

    readings_by_zone: dict[str, list[Reading]] = {zone: [] for zone in ALLOWED_ZONES}
    for reading in payload.readings:
        if reading.sensor_id in readings_by_zone:
            readings_by_zone[reading.sensor_id].append(
                Reading(_epoch(reading.timestamp), reading.temp_c, reading.humidity)
            )

    now = _epoch(payload.now)
    assessments = []
    for entry in payload.inventory:
        item = Item(
            id=entry.id,
            name=entry.name.strip(),
            profile=entry.profile,
            zone=entry.zone,
            added_at=_epoch(entry.added_at),
            packaged=entry.packaged,
        )
        assessments.append(assess(item, readings_by_zone[item.zone], now))

    zone_average = {
        zone: (
            sum(reading.temp_c for reading in values) / len(values)
            if values else 4.44
        )
        for zone, values in readings_by_zone.items()
    }
    recommendations = recommend(assessments, zone_average)
    return {
        "items": [
            {
                "id": assessment.item.id,
                "score": assessment.score,
                "status": assessment.status,
                "profileLabel": assessment.profile.label,
                "remainingHours": round(assessment.remaining_hours, 2),
                "equivalentHours": round(assessment.equivalent_hours, 2),
                "elapsedHours": round(assessment.elapsed_hours, 2),
                "dangerZoneHours": round(assessment.danger_zone_hours, 2),
                "foodTempC": assessment.food_temp_c,
                "lossByCause": assessment.loss_by_cause,
                "condensationMinutes": round(assessment.condensation_minutes, 2),
                "gapHours": round(assessment.gap_hours, 2),
            }
            for assessment in assessments
        ],
        "recommendations": [
            {"level": recommendation.level, "title": recommendation.title, "reason": recommendation.reason,
             "itemId": recommendation.item_id}
            for recommendation in recommendations
        ],
    }


@app.post("/api/inventory/scan")
async def scan_inventory(image: UploadFile = File(...)):
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, WEBP, or GIF image.")
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")

    api_key = os.getenv("PERCEPTRON_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Photo scanning is not configured. Set PERCEPTRON_API_KEY on the backend.")

    prompt = (
        "Identify distinct food products clearly visible in this refrigerator or pantry photo. "
        "Return only JSON in this exact shape: {\"items\":[{\"name\":\"specific food name\","
        "\"profile\":\"poultry|dairy|greens|berries|produce|other\",\"confidence\":0.0}]}. "
        "Use poultry for raw meat/poultry, dairy for milk/yogurt/cheese, greens for leafy vegetables, "
        "berries for berries, produce for other whole fruits and vegetables, and other for eggs, leftovers, "
        "deli foods, and prepared refrigerated foods. Include only visible foods, do not infer hidden "
        "items, expiration, freshness, quantity, package state, or storage zone. If none are clear, return {\"items\":[]}."
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                PERCEPTRON_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data={"model": MODEL, "prompt": prompt, "max_tokens": "700"},
                files={"image_file": (image.filename or "inventory.jpg", image_bytes, image.content_type)},
            )
        response.raise_for_status()
        model_result = response.json()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Photo analysis timed out. Please try again.") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="The vision service could not analyze this image.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not reach the vision service. Please try again.") from exc

    text = model_result.get("text") if isinstance(model_result, dict) else None
    if not isinstance(text, str):
        raise HTTPException(status_code=502, detail="The vision service returned an unexpected response.")
    return {"items": _normalize_items(_extract_json(text))}
