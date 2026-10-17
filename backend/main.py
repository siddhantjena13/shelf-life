"""HTTP endpoints for the ShelfLife dashboard."""

import logging
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

import vision
from inventory import router as inventory_router
from readings import router as readings_router
from risk import Item, Reading, assess, recommend
from risk.profiles import PROFILES
from store import create_store

# Settings (PERCEPTRON_API_KEY, SQLITE_PATH, ...) are read when used, so
# loading backend/.env here covers every module. Real env vars take precedence.
load_dotenv(Path(__file__).with_name(".env"))

ALLOWED_ZONES = {"top", "mid", "bottom"}

log = logging.getLogger("shelfsense")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = create_store()
    try:
        await app.state.store.setup()
    except PyMongoError as exc:
        log.error("Could not prepare MongoDB (%s). Inventory requests will fail until it is reachable.", exc)
    yield
    await app.state.store.close()


app = FastAPI(title="ShelfLife API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)
app.include_router(inventory_router)


@app.exception_handler(PyMongoError)
async def database_unavailable(request: Request, exc: PyMongoError):
    log.error("MongoDB error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Could not reach MongoDB. Check MONGODB_URI in backend/.env and that the database is running."},
    )


@app.exception_handler(sqlite3.Error)
async def database_failed(request: Request, exc: sqlite3.Error):
    log.error("SQLite error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=503, content={"detail": "The inventory database could not complete that request."})
app.include_router(readings_router)  # live ESP32 readings: see readings.py


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


@app.get("/api/health")
async def health(request: Request):
    store = request.app.state.store
    return {
        "ok": True,
        "database": store.kind,
        "databaseReachable": await store.ping(),
        "vision": vision.is_configured(),
        "visionModel": vision.model_name(),
    }


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
