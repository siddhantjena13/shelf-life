"""Inventory persistence.

By default the inventory lives in a local SQLite file (backend/data/
shelfsense.db): free, nothing to install, and it survives restarts. Setting
MONGODB_URI switches to MongoDB instead, for example a free Atlas cluster.

Both stores exchange the same item dicts: `_id`, timezone-aware datetimes,
and the item's freshness checks embedded as a `checks` list.
"""

import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)

DEFAULT_SQLITE_PATH = Path(__file__).with_name("data") / "shelfsense.db"
DEFAULT_MONGO_DB = "shelflife"


class Store(Protocol):
    kind: str

    async def setup(self) -> None: ...
    async def ping(self) -> bool: ...
    async def close(self) -> None: ...
    async def list_items(self, closed_since: datetime) -> list[dict]: ...
    async def get_item(self, item_id: str) -> dict | None: ...
    async def insert_item(self, doc: dict) -> dict: ...
    async def update_item(self, item_id: str, changes: dict, check: dict | None = None) -> dict | None: ...
    async def delete_item(self, item_id: str) -> bool: ...
    async def save_photo(self, photo: dict) -> None: ...
    async def get_photo(self, photo_id: str) -> dict | None: ...


SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    profile         TEXT NOT NULL,
    zone            TEXT NOT NULL,
    packaged        INTEGER NOT NULL DEFAULT 0,
    added_at        TEXT NOT NULL,
    expires_on      TEXT,
    date_kind       TEXT,
    freshness       TEXT,
    freshness_note  TEXT,
    photo_id        TEXT,
    last_checked_at TEXT,
    state           TEXT NOT NULL DEFAULT 'active',
    closed_at       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_by_state ON items (state, created_at);

CREATE TABLE IF NOT EXISTS checks (
    id          TEXT PRIMARY KEY,
    item_id     TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    at          TEXT NOT NULL,
    freshness   TEXT,
    note        TEXT,
    expires_on  TEXT,
    date_kind   TEXT,
    source      TEXT NOT NULL,
    photo_id    TEXT,
    confidence  REAL
);
CREATE INDEX IF NOT EXISTS checks_by_item ON checks (item_id, at);

-- item_id is not a foreign key: a new item's photo is saved just before the item.
CREATE TABLE IF NOT EXISTS photos (
    id           TEXT PRIMARY KEY,
    item_id      TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data         BLOB NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_by_item ON photos (item_id);
"""

ITEM_COLUMNS = {
    "name", "profile", "zone", "packaged", "added_at", "expires_on", "date_kind", "freshness",
    "freshness_note", "photo_id", "last_checked_at", "state", "closed_at", "created_at", "updated_at",
}
ITEM_DATETIMES = {"added_at", "last_checked_at", "closed_at", "created_at", "updated_at"}
CHECK_COLUMNS = ("id", "at", "freshness", "note", "expires_on", "date_kind", "source", "photo_id", "confidence")


def _to_db(value):
    # One fixed ISO format (UTC, microseconds) so text comparison orders by time.
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if isinstance(value, bool):
        return int(value)
    return value


def _from_db(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class SqliteStore:
    kind = "sqlite"

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.db: sqlite3.Connection | None = None

    # Calls are synchronous: each is a fast local query, and running them on
    # the event loop keeps every request's reads and writes atomic.
    async def setup(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        log.info("Inventory database: %s", self.path)

    async def ping(self) -> bool:
        try:
            self.db.execute("SELECT 1")
            return True
        except (sqlite3.Error, AttributeError):
            return False

    async def close(self) -> None:
        if self.db is not None:
            self.db.close()

    def _item(self, row: sqlite3.Row, checks: list[sqlite3.Row]) -> dict:
        item = dict(row)
        item["_id"] = item.pop("id")
        item["packaged"] = bool(item["packaged"])
        for key in ITEM_DATETIMES:
            item[key] = _from_db(item[key])
        item["checks"] = [{**dict(c), "at": _from_db(c["at"])} for c in checks]
        for check in item["checks"]:
            check.pop("item_id")
        return item

    def _insert_check(self, item_id: str, check: dict) -> None:
        self.db.execute(
            f"INSERT INTO checks (item_id, {', '.join(CHECK_COLUMNS)}) VALUES (?{', ?' * len(CHECK_COLUMNS)})",
            [item_id, *(_to_db(check.get(col)) for col in CHECK_COLUMNS)],
        )

    async def list_items(self, closed_since: datetime) -> list[dict]:
        visible = "state = 'active' OR closed_at >= ?"
        since = _to_db(closed_since)
        rows = self.db.execute(f"SELECT * FROM items WHERE {visible} ORDER BY created_at DESC", [since]).fetchall()
        checks: dict[str, list] = {}
        for c in self.db.execute(
            f"SELECT * FROM checks WHERE item_id IN (SELECT id FROM items WHERE {visible}) ORDER BY at, rowid",
            [since],
        ):
            checks.setdefault(c["item_id"], []).append(c)
        return [self._item(row, checks.get(row["id"], [])) for row in rows]

    async def get_item(self, item_id: str) -> dict | None:
        row = self.db.execute("SELECT * FROM items WHERE id = ?", [item_id]).fetchone()
        if row is None:
            return None
        checks = self.db.execute("SELECT * FROM checks WHERE item_id = ? ORDER BY at, rowid", [item_id]).fetchall()
        return self._item(row, checks)

    async def insert_item(self, doc: dict) -> dict:
        fields = {k: v for k, v in doc.items() if k in ITEM_COLUMNS}
        with self.db:
            self.db.execute(
                f"INSERT INTO items (id, {', '.join(fields)}) VALUES (?{', ?' * len(fields)})",
                [doc["_id"], *map(_to_db, fields.values())],
            )
            for check in doc.get("checks", []):
                self._insert_check(doc["_id"], check)
        return await self.get_item(doc["_id"])

    async def update_item(self, item_id: str, changes: dict, check: dict | None = None) -> dict | None:
        unknown = changes.keys() - ITEM_COLUMNS
        if unknown:
            raise ValueError(f"Unknown item fields: {', '.join(sorted(unknown))}")
        with self.db:
            if changes:
                assignments = ", ".join(f"{col} = ?" for col in changes)
                updated = self.db.execute(
                    f"UPDATE items SET {assignments} WHERE id = ?", [*map(_to_db, changes.values()), item_id]
                ).rowcount
            else:
                updated = self.db.execute("SELECT COUNT(*) FROM items WHERE id = ?", [item_id]).fetchone()[0]
            if not updated:
                return None
            if check is not None:
                self._insert_check(item_id, check)
        return await self.get_item(item_id)

    async def delete_item(self, item_id: str) -> bool:
        with self.db:
            deleted = self.db.execute("DELETE FROM items WHERE id = ?", [item_id]).rowcount
            if deleted:
                self.db.execute("DELETE FROM photos WHERE item_id = ?", [item_id])
        return bool(deleted)

    async def save_photo(self, photo: dict) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO photos (id, item_id, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)",
                [photo["_id"], photo["item_id"], photo["content_type"], photo["data"], _to_db(photo["created_at"])],
            )

    async def get_photo(self, photo_id: str) -> dict | None:
        row = self.db.execute("SELECT content_type, data FROM photos WHERE id = ?", [photo_id]).fetchone()
        return dict(row) if row else None


class MongoStore:
    kind = "mongodb"

    def __init__(self, uri: str, db_name: str | None):
        from pymongo import AsyncMongoClient

        self.client = AsyncMongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=5000, appname="shelflife")
        db = self.client[db_name] if db_name else self.client.get_default_database(DEFAULT_MONGO_DB)
        self.items = db["items"]
        self.photos = db["photos"]

    async def setup(self) -> None:
        await self.items.create_index([("state", 1), ("created_at", -1)])
        await self.items.create_index("closed_at", sparse=True)
        await self.photos.create_index("item_id")

    async def ping(self) -> bool:
        try:
            await self.client.admin.command("ping")
            return True
        except Exception:  # noqa: BLE001 - any failure means "not reachable"
            return False

    async def close(self) -> None:
        await self.client.close()

    async def list_items(self, closed_since: datetime) -> list[dict]:
        query = {"$or": [{"state": "active"}, {"closed_at": {"$gte": closed_since}}]}
        return await self.items.find(query).sort("created_at", -1).to_list(length=None)

    async def get_item(self, item_id: str) -> dict | None:
        return await self.items.find_one({"_id": item_id})

    async def insert_item(self, doc: dict) -> dict:
        await self.items.insert_one(doc)
        return doc

    async def update_item(self, item_id: str, changes: dict, check: dict | None = None) -> dict | None:
        from pymongo import ReturnDocument

        update: dict = {}
        if changes:
            update["$set"] = changes
        if check is not None:
            update["$push"] = {"checks": check}
        if not update:
            return await self.get_item(item_id)
        return await self.items.find_one_and_update({"_id": item_id}, update, return_document=ReturnDocument.AFTER)

    async def delete_item(self, item_id: str) -> bool:
        result = await self.items.delete_one({"_id": item_id})
        if result.deleted_count:
            await self.photos.delete_many({"item_id": item_id})
        return bool(result.deleted_count)

    async def save_photo(self, photo: dict) -> None:
        await self.photos.insert_one(photo)

    async def get_photo(self, photo_id: str) -> dict | None:
        return await self.photos.find_one({"_id": photo_id})


def create_store() -> Store:
    uri = os.getenv("MONGODB_URI")
    if uri:
        return MongoStore(uri, os.getenv("MONGODB_DB"))
    return SqliteStore(os.getenv("SQLITE_PATH") or DEFAULT_SQLITE_PATH)
