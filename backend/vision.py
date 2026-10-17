"""Photo analysis with Perceptron Mk1.

Two questions are asked of a photo:
  identify(): which foods are in it, how fresh they look, and any printed date.
  inspect():  for a food already in the inventory, how fresh it looks now.

Results are suggestions the user confirms or edits before anything is saved.
The model judges only what is visible; it cannot see bacteria, smell, or
temperature history, which is why freshness is kept separate from the
sensor-based risk score.
"""

import base64
import json
import logging
import os
import re
from datetime import date

import httpx

from risk.profiles import PROFILES

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.perceptron.inc/v1"
DEFAULT_MODEL = "perceptron-mk1.5"
# Mk1.5 reasons at "high" effort unless told otherwise, which is slow for a
# quick photo check. Override with PERCEPTRON_REASONING (none, low, medium, high).
DEFAULT_REASONING = "none"
REASONING_TIERS = ("none", "minimal", "low", "medium", "high")
TIMEOUT_S = 60
MAX_ITEMS = 8

FRESHNESS = ("fresh", "good", "fair", "poor", "spoiled")
DATE_KINDS = ("use_by", "best_by", "sell_by", "expires")

# Printed dates outside this window are almost certainly misreads.
OLDEST_DATE_DAYS = 2 * 365
NEWEST_DATE_DAYS = 5 * 365


class VisionError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def model_name() -> str:
    return os.getenv("PERCEPTRON_MODEL") or DEFAULT_MODEL


def reasoning_effort() -> str:
    tier = (os.getenv("PERCEPTRON_REASONING") or DEFAULT_REASONING).strip().lower()
    return tier if tier in REASONING_TIERS else DEFAULT_REASONING


def is_configured() -> bool:
    return bool(os.getenv("PERCEPTRON_API_KEY"))


# Shared field definitions. Strings use "" rather than null for "not seen" so
# the schema stays within what constrained decoders reliably support.
_OBSERVATION_PROPS = {
    "freshness": {"type": "string", "enum": [*FRESHNESS, "unknown"]},
    "freshness_note": {"type": "string"},
    "date_text": {"type": "string"},
    "expires_on": {"type": "string"},
    "date_kind": {"type": "string", "enum": [*DATE_KINDS, "none"]},
}

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "profile": {"type": "string", "enum": list(PROFILES)},
        "confidence": {"type": "number"},
        "packaged": {"type": "boolean"},
        **_OBSERVATION_PROPS,
    },
    "required": ["name", "profile", "confidence", "packaged", *_OBSERVATION_PROPS],
    "additionalProperties": False,
}

IDENTIFY_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": _ITEM_SCHEMA}},
    "required": ["items"],
    "additionalProperties": False,
}

INSPECT_SCHEMA = {
    "type": "object",
    "properties": {
        "shows_item": {"type": "boolean"},
        "confidence": {"type": "number"},
        **_OBSERVATION_PROPS,
    },
    "required": ["shows_item", "confidence", *_OBSERVATION_PROPS],
    "additionalProperties": False,
}

_OBSERVATION_RULES = """\
- freshness: judge only what you can see. fresh = looks just bought; good = normal, no visible decline; \
fair = early signs such as slight wilting, softening or dull color; poor = clear decline such as browning, \
bruising, sliminess or dried edges; spoiled = mold, rot or obvious spoilage. Use unknown when packaging \
hides the food or the photo is too unclear to judge.
- freshness_note: one short sentence naming the visual evidence for the rating, or "".
- date_text: the exact printed text of a use-by, best-by, sell-by or expiration date if it is legible, \
else "". Ignore packed-on dates, production dates and lot codes.
- expires_on: that date as YYYY-MM-DD, else "". If no year is printed, pick the year that puts the date \
closest to today.
- date_kind: use_by, best_by, sell_by or expires to match the label wording, else none."""


def identify_prompt(today: date) -> str:
    return f"""You are cataloguing food for a refrigerator inventory app. Today is {today.isoformat()}.
List each distinct food item that is clearly visible in the photo, at most {MAX_ITEMS}. For each item:
- name: a short, specific name a person would write on a shopping list, such as "Whole milk", \
"Baby spinach" or "Chicken thighs". Include a brand only when it identifies the product.
- profile: the closest storage category. poultry = raw meat or poultry; dairy = milk, yogurt, cheese, \
cream; greens = leafy vegetables and salad mixes; berries = strawberries and other berries; produce = \
other whole fruits and vegetables; other = eggs, leftovers, deli, sauces, prepared food and anything else.
- confidence: 0 to 1, how sure you are of the name.
- packaged: true if it is sealed or in a closed bag or container.
{_OBSERVATION_RULES}
Return JSON only. If no food is clearly visible, return {{"items": []}}."""


def inspect_prompt(name: str, profile: str, today: date) -> str:
    label = PROFILES[profile].label if profile in PROFILES else "food"
    return f"""You are checking a food item for a refrigerator inventory app. Today is {today.isoformat()}.
The photo should show this item: {json.dumps(name)} (category: {label}).
- shows_item: true if the photo shows this food or its package, else false.
- confidence: 0 to 1, how sure you are of the freshness rating.
{_OBSERVATION_RULES}
Return JSON only."""


async def _complete(body: dict, api_key: str) -> dict:
    """POST one chat completion. Split out so tests can stub the network."""
    base_url = (os.getenv("PERCEPTRON_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
        )
    if response.status_code >= 400:
        detail = _upstream_message(response)
        log.warning("Perceptron returned %s: %s", response.status_code, detail)
        if response.status_code in (401, 403):
            raise VisionError(502, "Perceptron rejected the API key. Check PERCEPTRON_API_KEY.")
        if response.status_code == 404:
            raise VisionError(502, f'Perceptron does not offer the model "{body["model"]}". Check PERCEPTRON_MODEL.')
        if response.status_code == 429:
            raise VisionError(429, "Perceptron's rate limit was reached. Wait a moment and try again.")
        raise VisionError(502, f"Perceptron could not analyze this photo: {detail}" if detail
                          else "Perceptron could not analyze this photo.")
    try:
        return response.json()
    except ValueError as exc:
        raise VisionError(502, "Perceptron returned an unreadable response.") from exc


def _upstream_message(response: httpx.Response) -> str:
    try:
        error = response.json().get("error")
        message = error.get("message") if isinstance(error, dict) else error
        return str(message or "")[:300]
    except (ValueError, AttributeError):
        return response.text[:300]


async def _ask(image: bytes, content_type: str, prompt: str, schema: dict, schema_name: str, max_tokens: int) -> dict:
    api_key = os.getenv("PERCEPTRON_API_KEY")
    if not api_key:
        raise VisionError(503, "Photo recognition is not set up. Add PERCEPTRON_API_KEY to backend/.env.")

    data_url = f"data:{content_type};base64,{base64.b64encode(image).decode('ascii')}"
    body = {
        "model": model_name(),
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": prompt},
            ],
        }],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        },
        "reasoning_effort": reasoning_effort(),
        # Reasoning tokens count against this budget, so leave room for them.
        "max_completion_tokens": max_tokens if reasoning_effort() == "none" else max_tokens + 2048,
        "temperature": 0,
    }
    try:
        payload = await _complete(body, api_key)
    except httpx.TimeoutException as exc:
        raise VisionError(504, "Photo analysis timed out. Try again or enter the details yourself.") from exc
    except httpx.HTTPError as exc:
        raise VisionError(502, "Could not reach Perceptron. Check your connection and try again.") from exc

    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise VisionError(502, "Perceptron returned an unexpected response.") from exc
    if not isinstance(content, str):
        raise VisionError(502, "Perceptron returned an empty answer.")
    result = extract_json(content)
    if not isinstance(result, dict):
        raise VisionError(502, "Perceptron returned an unexpected answer. Try another photo.")
    return result


def extract_json(text: str) -> object:
    """Parse the model's answer, tolerating reasoning tags and Markdown fences."""
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", stripped, re.IGNORECASE | re.DOTALL)
    candidate = fenced.group(1) if fenced else stripped
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(candidate[start:end + 1])
            except json.JSONDecodeError:
                pass
    raise VisionError(502, "Perceptron's answer could not be read. Try another photo.")


def _text(value: object, limit: int) -> str | None:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()[:limit]
    return cleaned or None


def _confidence(value: object) -> float:
    try:
        return round(max(0.0, min(1.0, float(value))), 2)
    except (TypeError, ValueError):
        return 0.5


def _observation(raw: dict, today: date) -> dict:
    freshness = raw.get("freshness")
    expires_on = None
    try:
        parsed = date.fromisoformat(str(raw.get("expires_on") or "").strip())
        if -OLDEST_DATE_DAYS <= (parsed - today).days <= NEWEST_DATE_DAYS:
            expires_on = parsed.isoformat()
    except ValueError:
        pass
    date_kind = raw.get("date_kind") if raw.get("date_kind") in DATE_KINDS else None
    return {
        "freshness": freshness if freshness in FRESHNESS else None,
        "freshnessNote": _text(raw.get("freshness_note"), 200),
        "dateText": _text(raw.get("date_text"), 60),
        "expiresOn": expires_on,
        "dateKind": (date_kind or "expires") if expires_on else None,
    }


def normalize_identified(payload: dict, today: date) -> list[dict]:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise VisionError(502, "Perceptron did not return a list of foods.")
    items, seen = [], set()
    for raw in raw_items[:MAX_ITEMS]:
        if not isinstance(raw, dict):
            continue
        name = _text(raw.get("name"), 80)
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        profile = str(raw.get("profile", "")).lower()
        items.append({
            "name": name,
            "profile": profile if profile in PROFILES else "other",
            "confidence": _confidence(raw.get("confidence")),
            "packaged": raw.get("packaged") is True,
            **_observation(raw, today),
        })
    return items


def normalize_inspected(payload: dict, today: date) -> dict:
    return {
        "showsItem": payload.get("shows_item") is not False,
        "confidence": _confidence(payload.get("confidence")),
        **_observation(payload, today),
    }


async def identify(image: bytes, content_type: str, today: date) -> list[dict]:
    payload = await _ask(image, content_type, identify_prompt(today), IDENTIFY_SCHEMA, "food_items", 1500)
    return normalize_identified(payload, today)


async def inspect(image: bytes, content_type: str, name: str, profile: str, today: date) -> dict:
    payload = await _ask(image, content_type, inspect_prompt(name, profile, today), INSPECT_SCHEMA, "freshness_check", 800)
    return normalize_inspected(payload, today)
