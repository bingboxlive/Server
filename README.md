<img src="public/img/bingbox.webp" alt="BingBox Logo" width="200" />

## 
BingBox is a collaborative music streaming application that allows users to queue and listen to music together in real-time. It serves as the backend for the PEAK mod of the same name, allowing Bing Bong to act as a positional speaker.

## Getting Started

You can easily run the project using the Docker Compose example:

```bash
docker compose -f compose.yml.example up
```

## Deployment

> [!IMPORTANT]
> When deploying, this application **must** be placed behind a reverse proxy that supports **WebSockets** and **WebRTC**.
