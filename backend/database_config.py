"""Select storage explicitly; demos default to local SQLite."""

import os


def mongo_uri() -> str | None:
    backend = os.getenv("DATABASE_BACKEND", "sqlite").strip().lower()
    if backend == "sqlite":
        return None
    if backend != "mongodb":
        raise ValueError("DATABASE_BACKEND must be sqlite or mongodb")
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise ValueError("MONGODB_URI is required when DATABASE_BACKEND=mongodb")
    return uri
