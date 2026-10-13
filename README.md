ShelfSense (DubHacks 2026)

A portable hardware and software system that monitors food storage environments, assesses cumulative risks, and provides actionable recommendations to reduce food waste.

The Concept

Standard monitoring only shows current temperatures. ShelfSense tracks historical environmental exposure tailored to specific food profiles (e.g., raw poultry vs. leafy greens) to better estimate food quality and safety risks.

Core Features

Hardware Monitoring: Tracks temperature, humidity, and door-opening frequency.

Risk Engine: Evaluates accumulated environmental exposure against food-specific guidelines to generate storage-quality scores.

Actionable Dashboard: Displays live data, historical charts, inventory, and tailored recommendations (e.g., "Relocate produce," "Check door seal").

Tech Stack

Hardware: Raspberry Pi, ESP32 (optional), Temp/Humidity sensors.

Software: React (Frontend), Python/FastAPI (Backend), SQLite.

Hackathon MVP

Working hardware sensors, live dashboard visualization, 3 tailored food profiles, historical exposure tracking, and a live cooler demonstration.

Safety Note

ShelfSense provides environmental decision support. Ambient sensors assess storage risk but cannot directly detect pathogens or calculate exact remaining shelf life.
