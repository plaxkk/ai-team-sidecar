# Deployment Guide

## Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start both daemon and dashboard
npm run start
```

The dashboard opens at `http://localhost:4041`.

## Docker

Build and run with Docker:

```bash
docker build -t aiteam .

docker run -d \
  -p 4041:8080 \
  -v aiteam-data:/app/data \
  aiteam
```

Environment variables inside the container:
- `DATA_DIR` — defaults to `/app/data`
- `PORT` — defaults to `8080`

## Fly.io

A `fly.toml` is included for one-command deployment:

```bash
fly launch
fly deploy
```

The default config:
- Region: Hong Kong (`hkg`)
- VM: 256MB, shared CPU
- Persistent volume `ats_data` mounted at `/app/data`
- Auto-stop/start machines (scales to zero when idle)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AITEAM_CONFIG` | `~/.aiteam/config.json` | Path to config file |
| `DATA_DIR` | `~/.aiteam/data` | SQLite DB and runtime data |
| `PORT` | `4041` | Dashboard server port |

See `.env.example` for a template.

## Health Check

After deployment, verify the service is running:

```bash
curl http://localhost:4041/api/overview
```
