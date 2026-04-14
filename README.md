# Google Meet AI Scribe MVP

A Next.js MVP for the internship task:

- sign up and log in to a private account
- paste a Google Meet link
- launch a bot session
- capture transcript/captions through a bot pipeline
- generate a concise summary
- persist each meeting transcript and summary locally

## Current status

This version supports a real `captions` bot mode backed by Playwright. It can:

- launch Chromium
- sign into Google with env-provided credentials or a saved storage state
- join a Google Meet
- keep the bot browser muted locally
- turn captions on
- scrape live caption text
- generate a structured summary

`mock` mode is still available as a fallback for quick demos.

## Stored output

Each session is written to `data/sessions/<session-id>.json` as the pipeline
runs. That means:

- transcript chunks are saved incrementally
- summaries are persisted when generation completes
- stored runs are reloaded after a server restart
- `GET /api/sessions` returns saved session history

User accounts are stored locally in `data/users.json` for development. Login is
cookie-based, and session history is filtered per user so each account only sees
its own saved runs.

## Run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

Copy `.env.example` to `.env.local` and fill in the bot configuration you want:

- `AUTH_SECRET=...`
- `DATA_ROOT=...`
- `MEET_BOT_MODE=captions`
- `MEET_BOT_NAME=Meet AI Scribe`
- `MEET_BOT_HEADLESS=false`
- `MEET_ALLOW_MANUAL_LOGIN=true`
- `MEET_MANUAL_LOGIN_TIMEOUT_MS=180000`
- `MEET_FIRST_CAPTION_TIMEOUT_MS=45000`
- `MEET_CAPTION_CAPTURE_MS=90000`
- `MEET_CAPTION_POLL_MS=1500`
- `MEET_CAPTION_IDLE_TIMEOUT_MS=15000`
- `GOOGLE_ACCOUNT_EMAIL=...`
- `GOOGLE_ACCOUNT_PASSWORD=...`
- `GOOGLE_ACCOUNT_STORAGE_STATE_PATH=playwright/.auth/google-meet.json`
- `CHROME_EXECUTABLE_PATH=...`
- `GOOGLE_GENERATIVE_AI_API_KEY=...`
- `OPENAI_API_KEY=...`

If no LLM API key is present, the app falls back to a heuristic summary so the MVP remains demoable.

## Firebase App Hosting prep

This repo now includes [apphosting.yaml](/Users/shivanshmundra/Downloads/Summariser_bot/apphosting.yaml) for Firebase App Hosting. The prep work includes:

- a configurable `DATA_ROOT` so runtime data can be written outside the repo tree
- App Hosting runtime config tuned for a small Next.js deployment
- Firebase secret references for `AUTH_SECRET` and `GOOGLE_GENERATIVE_AI_API_KEY`
- `MEET_BOT_MODE=mock` at runtime by default, so the hosted web app stays stable before the Playwright bot is moved to a separate service

For App Hosting, the current prep assumes:

- the web app is deployed first
- local JSON/RAG data is written to the runtime data directory
- the long-running Meet bot and durable cloud storage will be split out later

Suggested next deploy steps:

```bash
firebase login
firebase init apphosting
firebase apphosting:backends:create --project YOUR_PROJECT_ID
```

Then add these App Hosting secrets:

```bash
firebase apphosting:secrets:set AUTH_SECRET
firebase apphosting:secrets:set GOOGLE_GENERATIVE_AI_API_KEY
```

After backend creation, connect the GitHub repo and set the live branch in Firebase App Hosting.

## Netlify deployment prep

This repo now includes [netlify.toml](/Users/shivanshmundra/Downloads/Summariser_bot/netlify.toml) for a Netlify deployment path.

Important deployment notes:

- the current hosted-safe default should be `MEET_BOT_MODE=mock`
- runtime storage must use a writable temp directory through `DATA_ROOT`
- environment variables for the Next.js server functions should be set in the Netlify dashboard

Recommended Netlify environment variables:

- `AUTH_SECRET`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `DATA_ROOT=/tmp/meet-ai-scribe`
- `MEET_BOT_MODE=mock`

Optional if you later host the real bot flow elsewhere:

- `MEET_BOT_NAME`
- `MEET_BOT_HEADLESS`
- `MEET_ALLOW_MANUAL_LOGIN`
- `MEET_MANUAL_LOGIN_TIMEOUT_MS`
- `MEET_FIRST_CAPTION_TIMEOUT_MS`
- `MEET_CAPTION_CAPTURE_MS`
- `MEET_CAPTION_POLL_MS`
- `MEET_CAPTION_IDLE_TIMEOUT_MS`
- `GOOGLE_ACCOUNT_EMAIL`
- `GOOGLE_ACCOUNT_PASSWORD`
- `GOOGLE_ACCOUNT_STORAGE_STATE_PATH`
- `CHROME_EXECUTABLE_PATH`

Suggested Netlify deploy steps:

1. Push this repo to GitHub.
2. In Netlify, select **Add new site** -> **Import an existing project**.
3. Connect the GitHub repo.
4. Netlify should detect the Next.js app automatically.
5. Before the first deploy, add the environment variables listed above in the Netlify UI.
6. Trigger the deploy.

For the first public deployment, keep the app in `mock` mode. After that works, move durable storage and the real Playwright Meet bot to separate cloud services before enabling the full bot flow in production.

## GCP Cloud Storage prep

The repo is now prepared to mirror local runtime artifacts into Google Cloud Storage using the official Node.js client.

Supported GCS env vars:

- `GCP_PROJECT_ID`
- `GCP_STORAGE_BUCKET`
- `GCP_STORAGE_PREFIX`
- `GCP_SERVICE_ACCOUNT_KEY_JSON`
- `GCP_SERVICE_ACCOUNT_KEY_BASE64`

What gets mirrored when GCS is configured:

- `users/users.json`
- `sessions/<session-id>.json`
- `rag/<session-id>.json`

Recommended production env values:

- `GCP_STORAGE_BUCKET=your-bucket-name`
- `GCP_STORAGE_PREFIX=meet-ai-scribe`
- `GCP_SERVICE_ACCOUNT_KEY_BASE64=<base64-encoded-service-account-json>`

Local storage still works as a fallback, so the app remains usable even if GCS credentials are not present yet.

## AWS S3 prep

The repo is also prepared to mirror runtime artifacts into AWS S3. If both AWS and GCP credentials are present, AWS S3 is used first.

Supported AWS env vars:

- `S3_REGION`
- `S3_BUCKET`
- `S3_PREFIX`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_SESSION_TOKEN`

What gets mirrored when S3 is configured:

- `users/users.json`
- `sessions/<session-id>.json`
- `rag/<session-id>.json`

Recommended production env values:

- `S3_REGION=ap-south-1`
- `S3_BUCKET=your-bucket-name`
- `S3_PREFIX=meet-ai-scribe`

Netlify reserves AWS runtime variable names like `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`, so the app uses the `S3_*` names above for deployment environments. The code still accepts the AWS-native names as a local fallback.

If you only want one cloud provider configured, just set the `S3_*` env vars and leave the GCP env vars empty.

## Auth flow

- sign up with name, email, and password
- log in with the same credentials
- a secure HTTP-only cookie keeps the session active for 7 days
- logging out clears the cookie

## Real bot notes

- The first login can take longer because Google may ask for verification steps that cannot be automated in every account configuration.
- If you keep `MEET_BOT_HEADLESS=false`, the first run can pause for a manual Google sign-in in the Playwright browser. Once that succeeds, the saved `storageState` is reused and the Sign in button should stop appearing on later runs.
- Using `GOOGLE_ACCOUNT_STORAGE_STATE_PATH` lets you persist a signed-in browser state after a successful run.
- The caption scraper is selector-light and relies on Meet live-region/caption heuristics, so it is more resilient than hard-coding one brittle class name, but Google Meet UI changes can still require updates.
