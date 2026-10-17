# ShelfLife

> Built at **DubHacks 2026**

A portable hardware and software system that monitors food storage environments, assesses cumulative risk, and provides actionable recommendations to reduce food waste.

---

## The Concept

Standard monitoring only shows the **current** temperature. A fridge that reads 38°F right now tells you nothing about the two hours it spent at 50°F overnight with the door ajar.

ShelfSense tracks **historical environmental exposure** and evaluates it against **food-specific profiles** (e.g., raw poultry vs. leafy greens) to better estimate food quality and safety risk over time.

## Core Features

- **Hardware Monitoring:** Tracks temperature, humidity, and door-opening frequency.
- **Risk Engine:** Evaluates accumulated environmental exposure against food-specific guidelines to generate storage-quality scores.
- **Actionable Dashboard:** Displays live data, historical charts, inventory, and tailored recommendations (e.g., *"Relocate produce"*, *"Check door seal"*).
- **Photo Inventory:** Snap a photo to log food. Perceptron Mk1.5 suggests what it is, how fresh it looks, and any printed use-by date. Every field stays editable. Re-log an item later with a new photo to track how its freshness changes.

## How It Works

```
┌──────────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│  Sensors             │      │  Backend (FastAPI)       │      │  Dashboard (React)  │
│  • Temp / humidity   │ ───▶ │  • Ingest readings       │ ───▶ │  • Live readings    │
│  • Door open/close   │      │  • Inventory in SQLite   │      │  • History charts   │
│  Raspberry Pi / ESP32│      │  • Risk engine scoring   │      │  • Photo inventory  │
└──────────────────────┘      │  • Recommendations       │      │  • Recommendations  │
                              │  • Perceptron photos     │      └─────────────────────┘
                              └──────────────────────────┘
```

1. Sensors sample the storage environment and log door events.
2. The backend stores readings and accumulates exposure history per storage unit.
3. The risk engine compares that exposure against each item's food profile to produce a storage-quality score.
4. The dashboard surfaces live conditions, trends, and recommendations.

## Tech Stack

| Layer    | Tools                                              |
| -------- | -------------------------------------------------- |
| Hardware | Raspberry Pi, ESP32 (optional), temperature/humidity sensors, door sensor |
| Backend  | Python, FastAPI, SQLite                            |
| Vision   | Perceptron Mk1.5 (food recognition, freshness, printed dates) |
| Frontend | React                                              |

## Hackathon MVP

- [ ] Working hardware sensors
- [ ] Live dashboard visualization
- [ ] Food-specific risk profiles, including broad estimated fallbacks
- [ ] Historical exposure tracking
- [ ] Live cooler demonstration

## Getting Started

> Update these steps to match the final repo layout.

**Backend**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your Perceptron key
uvicorn main:app --reload
```
`backend/.env` (git-ignored) holds the settings:

- `PERCEPTRON_API_KEY` turns on photo recognition. Get a key at [platform.perceptron.inc](https://platform.perceptron.inc). Without it, photos are still saved and you fill in the details yourself. `PERCEPTRON_MODEL` defaults to `perceptron-mk1.5`. `PERCEPTRON_REASONING` defaults to `none`, which answers in about a second. Higher tiers (`low`, `medium`, `high`) are slower and in testing did not read food or dates any better.
- The inventory is saved in a local SQLite file, `backend/data/shelfsense.db`, created on first run. There is nothing to install or pay for. Delete the file to start over. `SQLITE_PATH` moves it.
- To share one inventory across machines later, set `MONGODB_URI` to a MongoDB server, such as a free Atlas M0 cluster. The badge at the top of the Inventory page shows which database is in use.

Run the tests with `python -m pytest`. See `backend/risk/HOW_IT_WORKS.md` for how the risk model scores each item.

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
The dashboard opens at http://localhost:5173 and runs on simulated readings. The inventory and the cumulative-exposure risk engine need the backend running. Each item is scored only against readings from the time it went into the fridge. The sensor simulator provides one day of history, so an item stored before that is marked with an unknown-data gap.

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
| `GET /api/health` | Which database is active and whether photo recognition is set up |

**Hardware**
1. Wire the temperature/humidity sensor and door sensor to the Raspberry Pi (or ESP32).
2. Set the backend URL in the sensor config.
3. Run the sensor script to begin streaming readings.

## Safety Note

ShelfSense provides **environmental decision support**. Ambient sensors assess storage risk but **cannot directly detect pathogens** or calculate exact remaining shelf life. Always follow official food safety guidance (e.g., USDA/FDA) when deciding whether food is safe to eat.

## Team

- *Add team members here*
