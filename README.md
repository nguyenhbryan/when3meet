# When3Meet

When3Meet is a lightweight date-based availability picker inspired by When2meet. Instead of picking time blocks, users create an event with a date range, share the generated event link, and participants mark which dates work for them.

## Features

- Create an event with a unique shareable id
- View one calendar month at a time with a month/year selector
- Drag-select dates in a rectangular range
- Heatmap-style availability on calendar dates
- Hover a date to see which users selected it
- Optional per-user password for editing or deleting a response later
- Lightweight JSON-file storage, no database required

## Stack

- React + TypeScript
- Vite
- Small built-in Node HTTP server
- JSON file persistence in `.data/events.json`

## Local Development

Install dependencies:

```sh
npm install
```

Run the app:

```sh
npm run dev
```

Open:

```txt
http://127.0.0.1:5173
```

Build for production:

```sh
npm run build
```

Run the production server:

```sh
npm start
```

## Docker

Build and run with Docker Compose:

```sh
docker compose up --build
```

Open:

```txt
http://localhost:5173
```

Event data is persisted in the `when3meet-data` Docker volume mounted at `/app/.data`.

## Data Storage

Events are stored in:

```txt
.data/events.json
```

The `.data` directory is ignored by git so local event data is not committed.

## GitHub Container Registry

This repo includes a manual GitHub Actions workflow at:

```txt
.github/workflows/docker-image.yml
```

Run it from the GitHub Actions tab to build and publish a Linux Docker image to GitHub Packages under the repository.
