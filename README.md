# Day-Ahead Wind Generation Analysis

A full-stack, containerized dashboard built to analyze UK wind generation forecasts against actual output. Designed for utility trading desks to quantify day-ahead market risk using real-time Elexon BMRS data.

## Architecture & Stack

* **Frontend:** React (Vite), Tailwind CSS, Recharts
* **Backend:** FastAPI, Python, Pandas, NumPy
* **Infrastructure:** Docker, Docker Compose
* **Data Source:** Elexon BMRS API (`FUELHH` and `WINDFOR` streams)

## Core Logic

* **Asynchronous Ingestion:** Concurrent data fetching from Elexon API streams via `httpx`.
* **Data Pipeline:** Utilizes Pandas to filter raw generation data strictly for the `WIND` fuel type, standardizing and merging actuals with forecasted rolling windows.
* **Quantitative Metrics:** Calculates Mean Absolute Error (MAE) and Root Mean Square Error (RMSE) to provide a concrete baseline for forecast deviation.
* **Stateless UI:** The React frontend maps pre-calculated backend payloads directly to the visualization grid for high-performance rendering.

## Quick Start

The application is fully containerized. A Debian-based Node image and anonymous volumes are configured to ensure cross-platform compatibility without native OS binding conflicts.

1. Clone the repository:

```bash
git clone <your-repo-url>
cd <your-repo-name>

```

1. Build and run the containers:

```bash
docker-compose up --build

```

1. Access the application:

* **Frontend Dashboard:** `http://localhost:5173`
* **Backend API / Swagger UI:** `http://localhost:8000/docs`

## Repository Structure

* `/backend` - FastAPI server, Pandas data pipeline, and Python dependencies.
* `/frontend` - Vite React SPA, Tailwind configuration, and Recharts components.
* `docker-compose.yml` - Multi-container orchestration and anonymous volume mapping.

*Note: AI tools were utilized during the development of this project for architectural scaffolding, debugging, and styling, in accordance with the evaluation requirements.*
