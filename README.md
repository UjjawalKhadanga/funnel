# Funnel

A Redis backed rate limiter with queued admission.

## Local setup

Requires Node.js, npm, and Docker with Compose. RedisJSON is required; the Compose service supplies it.

    npm ci
    docker compose up -d --wait
    npm run dev

The API listens at http://127.0.0.1:3001. Override the port with PORT=3002 npm run dev.
Redis is available on localhost:6379 and persists its data in a Docker volume.

Register a key with one admission per 60 seconds, then consume it:

    curl http://127.0.0.1:3001/demo
    curl http://127.0.0.1:3001/demo/consume

Further consumes wait until a slot opens. Disconnecting the HTTP client cancels its pending request.

## Build and run

    npm run build
    npm start

## Tests

    npm test -- --timeout 5000

Tests use localhost:6379 and clear the shared config store. Run them against development Redis while the application is stopped.

## Stop

Stop the app with Ctrl+C in its terminal. Stop Redis with docker compose stop.
Restart Redis with docker compose up -d --wait.
