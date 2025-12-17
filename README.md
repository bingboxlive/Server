<img src="public/img/bingbox.webp" alt="BingBox Logo" width="200" />

## 
BingBox is a collaborative music streaming application that allows users to queue and listen to music together in real-time. It serves as the backend for the PEAK mod of the same name, allowing Bing Bong to act as a positional speaker.

## Getting Started

1. Rename the example configuration file and edit it as needed:
```bash
mv compose.yml.example compose.yml
```

2. Run the project:
```bash
docker compose up
```

## Deployment

> [!IMPORTANT]
> When deploying, this application **must** be placed behind a reverse proxy that supports **WebSockets** and **WebRTC**.
