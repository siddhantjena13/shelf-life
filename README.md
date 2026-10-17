# ShelfLife

> Built at **DubHacks 2026**

A portable hardware and software system that monitors food storage environments, assesses cumulative risk, and provides actionable recommendations to reduce food waste.

---

## The Concept

Standard monitoring only shows the **current** temperature. A fridge that reads 38°F right now tells you nothing about the two hours it spent at 50°F overnight with the door ajar.

ShelfLife tracks **historical environmental exposure** and evaluates it against **food-specific profiles** (e.g., raw poultry vs. leafy greens) to better estimate food quality and safety risk over time.

## Core Features

- **Hardware Monitoring:** Tracks temperature, humidity, and door-opening frequency.
- **Risk Engine:** Evaluates accumulated environmental exposure against food-specific guidelines to generate storage-quality scores.
- **Actionable Dashboard:** Displays live data, historical charts, inventory, and tailored recommendations (e.g., *"Relocate produce"*, *"Check door seal"*).

## How It Works

```
┌──────────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│  Sensors             │      │  Backend (FastAPI)       │      │  Dashboard (React)  │
│  • Temp / humidity   │ ───▶ │  • Ingest readings       │ ───▶ │  • Live readings    │
│  • Door open/close   │      │  • Store in SQLite       │      │  • History charts   │
│  Raspberry Pi / ESP32│      │  • Risk engine scoring   │      │  • Inventory        │
└──────────────────────┘      │  • Recommendations       │      │  • Recommendations  │
                              └──────────────────────────┘      └─────────────────────┘
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
uvicorn main:app --reload
```
See `backend/risk/HOW_IT_WORKS.md` for how the risk model scores each item.

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
The dashboard opens at http://localhost:5173 and runs on simulated readings. Start the backend as well to use the cumulative-exposure risk engine. Inventory is saved in the browser, and each item is scored only against readings from its recorded `addedAtMs` time onward. The sensor simulator provides one day of history, so an item stored earlier than the available sensor history is marked with an unknown-data gap by the backend model.

Set `PERCEPTRON_API_KEY` in the backend shell to enable photo-assisted inventory scanning. The key stays on the backend; without it, manual inventory entry and risk scoring still work, and the scan endpoint explains that scanning is not configured. The scan endpoint defaults to `perceptron-mk1`; set `PERCEPTRON_MODEL` to override it if your Perceptron account uses a different model ID.

The `Whole produce` and `Other refrigerated food` risk profiles are broad estimates. Select a more specific profile when one fits, and treat these scores as storage decision support rather than proof of food safety.

**Hardware**
1. Wire the temperature/humidity sensor and door sensor to the Raspberry Pi (or ESP32).
2. Set the backend URL in the sensor config.
3. Run the sensor script to begin streaming readings.

## Safety Note

ShelfLife provides **environmental decision support**. Ambient sensors assess storage risk but **cannot directly detect pathogens** or calculate exact remaining shelf life. Always follow official food safety guidance (e.g., USDA/FDA) when deciding whether food is safe to eat.

## Team

- *Add team members here*
