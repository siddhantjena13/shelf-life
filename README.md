# ShelfLife

> Built at **DubHacks 2026**

A portable hardware and software system that monitors food storage environments, assesses cumulative risk, and provides actionable recommendations to reduce food waste.

---

## The Concept

Standard monitoring only shows the **current** temperature. A fridge that reads 38°F right now tells you nothing about the two hours it spent at 50°F overnight with the door ajar.

ShelfLife tracks **historical environmental exposure** and evaluates it against **food-specific profiles** (e.g., raw poultry vs. leafy greens) to better estimate food quality and safety risk over time.

## Core Features

- **Hardware Monitoring:** ESP32 nodes with SHT31 sensors post temperature and humidity every few seconds. The dashboard polls for new readings.
- **Freshness Model:** Estimates each item's remaining shelf life as a range, combining the printed date, USDA storage times, temperature and humidity history, and photo or manual freshness checks.
- **Actionable Dashboard:** Live conditions, exposure charts, inventory, sensor status, and recommendations (e.g., *"Relocate produce"*, *"Check door seal"*).
- **Photo Inventory:** Snap a photo to log food. Perceptron Mk1.5 suggests what it is, how fresh it looks, and any printed use-by date. Every field stays editable. Re-log an item later with a new photo to track how its freshness changes.

## How It Works

```
┌──────────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│  ESP32 + SHT31       │      │  Backend (FastAPI)       │      │  Dashboard (React)  │
│  • Temp / humidity   │ ───▶ │  • Ingest readings       │ ───▶ │  • Live readings    │
│  POST /api/readings  │      │  • Inventory in SQLite   │      │  • History charts   │
└──────────────────────┘      │  • Risk engine scoring   │      │  • Photo inventory  │
                              │  • Recommendations       │      │  • Recommendations  │
                              │  • Perceptron photos     │      └─────────────────────┘
                              └──────────────────────────┘
```

1. Sensors sample the storage environment and post to the backend.
2. The backend stores readings (per fridge zone) and inventory separately.
3. The freshness model combines that exposure with each item's food profile, printed date and freshness checks to estimate how long it has left.
4. The dashboard surfaces live conditions, trends, inventory, and recommendations.

## Tech Stack

| Layer    | Tools                                              |
| -------- | -------------------------------------------------- |
| Hardware | ESP32 Dev Module, Adafruit SHT31 (temp / humidity) |
| Backend  | Python, FastAPI, SQLite (optional MongoDB)         |
| Vision   | Perceptron Mk1.5 (food recognition, freshness, printed dates) |
| Frontend | React, Vite                                        |

Food profiles in `backend/risk/profiles.py`: raw poultry, milk, leafy greens, strawberries, whole produce, other refrigerated food. `Whole produce` and `Other refrigerated food` are broad estimates.

## Hackathon MVP

- [x] Working hardware sensors (ESP32 firmware in `firmware/shelflife_sensor/`)
- [x] Live dashboard visualization (Dashboard, Inventory, Sensors, Alerts)
- [x] Food-specific risk profiles, including broad estimated fallbacks
- [x] Bayesian freshness model: estimates remaining shelf life as a range and the chance food is already past its best, using printed dates, temperature and humidity history, and photo or manual freshness checks
- [x] Historical exposure tracking
- [x] Live cooler demonstration

## Getting Started

**Backend**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then add your Perceptron key
uvicorn main:app --reload
```

`backend/.env` (git-ignored) holds the settings:

- `PERCEPTRON_API_KEY` turns on photo recognition. Get a key at [platform.perceptron.inc](https://platform.perceptron.inc). Without it, photos are still saved and you fill in the details yourself. `PERCEPTRON_MODEL` defaults to `perceptron-mk1.5`. `PERCEPTRON_REASONING` defaults to `none`, which answers in about a second. Higher tiers (`low`, `medium`, `high`) are slower and in testing did not read food or dates any better.
- Inventory is saved in `backend/data/shelfsense.db`, created on first run. Delete the file to start over. `SQLITE_PATH` moves it.
- Live sensor readings are saved in `backend/shelflife.db` (or `SHELFLIFE_DB`). Delete that file to clear history. Confirm devices with http://localhost:8000/api/devices.
- To share one inventory across machines later, set `MONGODB_URI` to a MongoDB server, such as a free Atlas M0 cluster. The badge at the top of the Inventory page shows which database is in use.

Run the tests with `python -m pytest` from `backend/`. See `backend/risk/HOW_IT_WORKS.md` for how the freshness model works and the research behind it.

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

The dashboard opens at http://localhost:5173. Vite proxies `/api` to the backend on port 8000.

If you're working on UI without the sensor, add `?source=sim` to the URL (`http://localhost:5173/?source=sim`). Live sensor setup is in [HARDWARE.md](HARDWARE.md).

To log food from a phone on the same Wi-Fi, run `npm run dev:phone` and open the `https://<your-computer's-IP>:5173` address it prints. Accept the self-signed certificate warning once. Browsers only allow a live camera preview over HTTPS. On plain HTTP, the Take photo button still opens the phone's own camera.

The `Whole produce` and `Other refrigerated food` risk profiles are broad estimates. Select a more specific profile when one fits, and treat these scores as storage decision support rather than proof of food safety.

### Inventory

- **Log food:** take a photo, or upload one, and Perceptron Mk1.5 suggests the food's name, category, whether it is sealed, how fresh it looks (fresh, good, fair, poor, spoiled) and any printed date it can read. Fields it filled in are marked with a sparkle. Several foods in one photo become separate items you can tick on or off.
- **Re-log:** take a new photo of an item to record how it looks now. Each check is kept, so the item page shows a before/after comparison, a freshness timeline and the photo history.
- **Used it / Tossed it:** finished items move to a 30-day history that tracks how much food was eaten rather than wasted. Delete is only for entries logged by mistake.
- Freshness from photos is kept separate from the sensor-based storage score. The camera sees surfaces, not bacteria or temperature history.

| Endpoint | Purpose |
| -------- | ------- |
| `GET /api/inventory` | Active items plus items finished in the last 30 days |
| `POST /api/inventory` | Log an item (optional photo and first freshness check) |
| `PATCH /api/inventory/{id}` | Edit an item, or set `state` to `used`, `tossed` or `active` |
| `DELETE /api/inventory/{id}` | Remove an item and its photos |
| `POST /api/inventory/{id}/checks` | Re-log: append a freshness check |
| `POST /api/inventory/scan` | Suggest items from a photo (saves nothing) |
| `POST /api/inventory/{id}/scan` | Suggest a freshness check for an item from a photo (saves nothing) |
| `GET /api/photos/{id}` | A stored photo |
| `POST /api/risk/assess` | Score inventory against sensor history |
| `GET /api/health` | Which database is active and whether photo recognition is set up |

### Sensors

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/readings` | ESP32 posts `{device_id, temp_c, humidity}` |
| `GET /api/readings?hours=24` | Dashboard history on load |
| `GET /api/readings?after_id=N` | Dashboard polling |
| `GET /api/devices` | Which devices have reported |

Default zone mapping: `shelflife_01` → top, `shelflife_02` → bottom. Override with `SHELFLIFE_DEVICE_ZONES`, for example `shelflife_01=top,shelflife_02=mid`.

Live sensor setup (hotspot, firmware, wiring, troubleshooting) is in [HARDWARE.md](HARDWARE.md).

## Safety Note

ShelfLife provides **environmental decision support**. Ambient sensors assess storage risk but **cannot directly detect pathogens** or calculate exact remaining shelf life. Always follow official food safety guidance (e.g., USDA/FDA) when deciding whether food is safe to eat.

## Team

- *Add team members here*
