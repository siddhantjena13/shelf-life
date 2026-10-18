import pytest

from database_config import mongo_uri
from store import SqliteStore, create_store


def test_default_sqlite_ignores_saved_atlas_uri(monkeypatch):
    monkeypatch.delenv("DATABASE_BACKEND", raising=False)
    monkeypatch.setenv("MONGODB_URI", "mongodb://saved-for-later")
    assert mongo_uri() is None
    assert isinstance(create_store(), SqliteStore)


def test_mongodb_requires_explicit_selection_and_uri(monkeypatch):
    monkeypatch.setenv("DATABASE_BACKEND", "mongodb")
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost")
    assert mongo_uri() == "mongodb://localhost"
    monkeypatch.delenv("MONGODB_URI")
    with pytest.raises(ValueError, match="MONGODB_URI is required"):
        mongo_uri()


def test_unknown_backend_is_rejected(monkeypatch):
    monkeypatch.setenv("DATABASE_BACKEND", "typo")
    with pytest.raises(ValueError, match="DATABASE_BACKEND"):
        mongo_uri()
