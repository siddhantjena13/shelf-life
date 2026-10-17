// ShelfLife sensor node: reads an SHT31 and posts it to the backend over Wi-Fi.
//
// Wiring (ESP32 -> SHT31):  3V3 -> VIN,  GND -> GND,  GPIO21 -> SDA,  GPIO22 -> SCL
// Board: "ESP32 Dev Module". Library: "Adafruit SHT31 Library".
// Settings (Wi-Fi, laptop address, device id) live in secrets.h. Copy
// secrets.example.h to secrets.h and fill it in; secrets.h is git-ignored.
//
// Serial Monitor at 115200 baud shows every reading and the HTTP result.
// The blue LED blinks once each time the backend accepts a reading.

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "Adafruit_SHT31.h"
#include "secrets.h"

const unsigned long SEND_EVERY_MS = 3000;     // how often to post a reading
const unsigned long WIFI_TIMEOUT_MS = 15000;  // give up a connect attempt after this
const int LED_PIN = 2;                        // built-in blue LED on most dev boards

Adafruit_SHT31 sht31;
bool sensorReady = false;
unsigned long lastSendMs = 0;

bool startSensor() {
  return sht31.begin(0x44) || sht31.begin(0x45);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting to Wi-Fi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWi-Fi connected, ESP32 address %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWi-Fi not connected (2.4 GHz network? right password?). Retrying next loop.");
  }
}

void blink() {
  digitalWrite(LED_PIN, HIGH);
  delay(60);
  digitalWrite(LED_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(LED_PIN, OUTPUT);
  Wire.begin(21, 22);  // SDA, SCL

  Serial.printf("\nShelfLife sensor %s -> %s\n", DEVICE_ID, SERVER_URL);
  sensorReady = startSensor();
  Serial.println(sensorReady ? "SHT31 ready" : "SHT31 NOT found - check wiring");
  connectWiFi();
}

void loop() {
  delay(20);
  if (millis() - lastSendMs < SEND_EVERY_MS) return;
  lastSendMs = millis();

  if (!sensorReady) {
    sensorReady = startSensor();
    if (!sensorReady) {
      Serial.println("SHT31 NOT found - check wiring");
      return;
    }
  }

  float t = sht31.readTemperature();
  float h = sht31.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Sensor read failed");
    sensorReady = false;
    return;
  }

  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("T=%.2f C  H=%.2f %%  (not sent: no Wi-Fi)\n", t, h);
    return;
  }

  char body[160];
  snprintf(body, sizeof(body), "{\"device_id\":\"%s\",\"temp_c\":%.2f,\"humidity\":%.2f}", DEVICE_ID, t, h);

  HTTPClient http;
  http.setTimeout(3000);
  http.begin(String(SERVER_URL) + "/api/readings");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);

  if (code == 200) {
    Serial.printf("T=%.2f C  H=%.2f %%  -> sent\n", t, h);
    blink();
  } else if (code > 0) {
    Serial.printf("T=%.2f C  H=%.2f %%  -> backend said %d: %s\n", t, h, code, http.getString().c_str());
  } else {
    Serial.printf("T=%.2f C  H=%.2f %%  -> could not reach %s (%s)\n", t, h, SERVER_URL,
                  http.errorToString(code).c_str());
  }
  http.end();
}
