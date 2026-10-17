// Copy this file to secrets.h in the same folder and fill it in.
// secrets.h is git-ignored, so passwords never end up on GitHub.

// Wi-Fi the ESP32 joins. Must be 2.4 GHz and a plain password network
// (a phone hotspot works; eduroam/UW does not). iPhone: turn on
// "Maximize Compatibility" in Personal Hotspot settings.
#define WIFI_SSID "your-hotspot-name"
#define WIFI_PASSWORD "your-hotspot-password"

// The laptop running the backend, on that same network, port 8000.
// Find the laptop's address on a Mac with:  ipconfig getifaddr en0
#define SERVER_URL "http://172.20.10.2:8000"

// shelflife_01 reports as the "top" zone, shelflife_02 as "bottom".
#define DEVICE_ID "shelflife_01"
