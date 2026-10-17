# Running ShelfLife with live sensors

```
ESP32 sensors ──Wi-Fi──▶ Laptop: backend (port 8000) + dashboard (port 5173) ◀──Wi-Fi── iPad (Safari)
                     all on the same phone hotspot
```

The ESP32s post a reading every 3 seconds to the backend on the laptop. The
dashboard polls the backend every 2 seconds, so the iPad shows a change within
a few seconds.

## 1. Network

Put the laptop, the iPad and the ESP32s on **one phone hotspot**. Venue Wi-Fi
often blocks devices from reaching each other, and the ESP32 can't join
eduroam-style networks. The ESP32 needs 2.4 GHz: on iPhone, turn on
**Maximize Compatibility** under Personal Hotspot.

Find the laptop's address on that network:

```bash
ipconfig getifaddr en0      # e.g. 172.20.10.2
```

## 2. Backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` lets the ESP32 reach it. If macOS asks whether Python may
accept incoming connections, click **Allow**. Readings are saved to
`backend/shelflife.db` (git-ignored); delete that file to start fresh.

Check what has reported: open `http://localhost:8000/api/devices`.

## 3. Dashboard

```bash
cd frontend
npm run dev
```

- Laptop: http://localhost:5173
- iPad: `http://<laptop address>:5173`, for example http://172.20.10.2:5173.
  In Safari, Share → Add to Home Screen opens it full screen.
- Simulated data (UI work without hardware, or as a demo backup):
  add `?source=sim` to the URL.

## 4. ESP32 firmware

1. Open `firmware/shelflife_sensor/shelflife_sensor.ino` in Arduino IDE.
2. Copy `secrets.example.h` to `secrets.h` in the same folder and fill in the
   hotspot name, password, `SERVER_URL` (`http://<laptop address>:8000`) and
   `DEVICE_ID` (`shelflife_01` or `shelflife_02`). `secrets.h` is git-ignored.
3. Board: **ESP32 Dev Module**. Library: **Adafruit SHT31 Library**. Upload.
4. Serial Monitor at 115200 baud should print `-> sent` every 3 seconds, and the
   blue LED blinks on each accepted reading.

Wiring: 3V3 → VIN, GND → GND, GPIO21 → SDA, GPIO22 → SCL.

## Devices and zones

| Device | Dashboard zone |
|---|---|
| `shelflife_01` | top |
| `shelflife_02` | bottom |

Change the mapping without editing code:
`SHELFLIFE_DEVICE_ZONES="shelflife_01=top,shelflife_02=mid" uvicorn main:app --host 0.0.0.0 --port 8000`

## API

| Method | Path | Used by |
|---|---|---|
| POST | `/api/readings` `{device_id, temp_c, humidity}` | ESP32 |
| GET | `/api/readings?hours=24` | dashboard, on load |
| GET | `/api/readings?after_id=N` | dashboard, polling |
| GET | `/api/devices` | quick health check |

Code: `backend/readings.py`, `frontend/src/data/live.js`, `firmware/shelflife_sensor/`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Serial: `Wi-Fi not connected` | 5 GHz network, wrong password, or a login-page network |
| Serial: `could not reach http://...` | Wrong laptop address, backend not started with `--host 0.0.0.0`, or devices on different networks |
| Serial: `backend said 422` | `DEVICE_ID` isn't mapped to a zone |
| Dashboard: `Waiting for readings…` | Backend not running, or no device has posted yet |
| iPad can't open the dashboard | iPad on a different network, or wrong address |
