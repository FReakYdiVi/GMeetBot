# Meet AI Scribe

A production-style internship project that joins a Google Meet, captures captions, generates structured meeting summaries, stores artifacts in cloud storage, and lets users query the meeting later through a contextualized RAG chatbot.

## What this product does

Meet AI Scribe turns a meeting link into a usable post-meeting workspace:

- authenticates users with sign up and log in
- accepts a Google Meet link and launches a bot session
- captures transcript/captions through a Playwright-based Google Meet bot
- generates a structured AI summary with Gemini
- stores users, sessions, and RAG artifacts
- lets users edit titles, notes, and generated summaries
- exports meeting summaries as `TXT` and `PDF`
- supports follow-up Q&A through a contextualized hybrid RAG chatbot

For public demos and safer hosting, the app also supports a `mock` bot mode.

## Core workflow

```text
User logs in
   |
   v
Paste Meet link + optional meeting title
   |
   v
Start session
   |
   +--> Mock mode
   |      |
   |      v
   |   demo transcript -> summary -> RAG
   |
   +--> Real captions mode
          |
          v
   Playwright bot joins Google Meet
          |
          v
   Turn on captions -> capture transcript chunks
          |
          v
   Generate structured summary with Gemini
          |
          v
   Build contextualized RAG index
          |
          v
   Store artifacts locally + mirror to AWS S3 / GCP
          |
          v
   User edits summary / downloads export / asks questions
```

## Product architecture

```text
                       +----------------------+
                       |   Next.js Frontend   |
                       |  auth + dashboard UI |
                       +----------+-----------+
                                  |
                                  v
                       +----------------------+
                       |   Next.js API Layer  |
                       | auth, sessions, chat |
                       +----------+-----------+
                                  |
            +---------------------+----------------------+
            |                                            |
            v                                            v
 +------------------------+                  +------------------------+
 | Session + User Storage |                  |  Bot / AI Processing   |
 | local JSON persistence |                  | Playwright + Gemini    |
 +-----------+------------+                  +-----------+------------+
             |                                           |
             v                                           v
   +---------------------+                    +------------------------+
   | AWS S3 / GCP mirror |                    | Summary + RAG artifacts|
   | users/sessions/rag  |                    | transcript + embeddings|
   +---------------------+                    +------------------------+
```

## Main features

### 1. Google Meet bot

- real Playwright-based Meet automation
- Google sign-in support through credentials or saved browser storage state
- caption-first transcript capture
- muted bot browser, fake media devices, and pre-join device handling
- resilient selector strategy and caption-region scraping

### 2. Structured AI summaries

Gemini generates four clean sections:

- `Overview`
- `Key Points`
- `Action Items`
- `Decisions`

The prompt is explicitly structured so these sections stay distinct:

- `Key Points` = what was discussed
- `Action Items` = what someone needs to do next
- `Decisions` = what was finalized

If no LLM key is present, the app falls back to a heuristic summary so the product remains demoable.

### 3. Editable meeting workspace

Each session becomes a small workspace:

- editable meeting title
- manual notes
- editable summary fields
- saved session history
- live transcript panel

### 4. Export support

Users can download a completed meeting as:

- `TXT`
- `PDF`

### 5. Contextualized meeting chatbot

Users can ask meeting-specific questions such as:

- "What decisions were made?"
- "What action items came out of the meeting?"
- "What did Neha say about the MVP?"
- "What happened earlier in the meeting?"

The chatbot answers only from retrieved meeting evidence and returns chunk citations.

## Contextualized RAG architecture

This project uses a contextualized hybrid RAG system rather than plain keyword lookup.

### Layer 1. Stored meeting memory

The chatbot retrieves from multiple meeting knowledge sources:

- transcript chunks
- generated summary sections
- manual meeting notes

### Layer 2. Contextual transcript chunks

Each transcript chunk is enriched before retrieval. A chunk stores:

- transcript text
- speaker
- timestamp
- neighboring transcript window
- meeting title
- inferred category

Each chunk also contains a contextualized text representation, for example:

```text
Meeting title: Product MVP sync.
Chunk type: transcript.
Category: action_item.
Speakers: Aarav, Neha.
Start timestamp: 2026-04-12T10:22:45.083Z.
Neighboring context: ...
Transcript chunk: Aarav: ...
```

This makes retrieval much stronger than using raw caption fragments alone.

### Layer 3. Query router

The question is first classified into one of these intents:

- `decisions`
- `action_items`
- `speaker`
- `timeline`
- `general`

That lets the system search the most relevant chunk types first.

### Layer 4. Hybrid retrieval

Retrieval combines:

- Gemini embeddings for semantic similarity
- BM25 for exact keyword / name matching
- lexical bonuses for route-specific relevance
- neighboring support chunk expansion

Hybrid retrieval flow:

```text
User question
   |
   v
Query router
   |
   v
Candidate chunk filter
   |
   +--> Gemini embedding similarity
   |
   +--> BM25 score
   |
   +--> lexical bonuses
   |
   v
Hybrid ranker
   |
   v
Top primary chunks
   |
   v
Neighbor chunk expansion
```

### Layer 5. Answer synthesis

The chatbot receives:

- the routed query intent
- primary evidence chunks
- supporting neighboring chunks
- meeting title and manual notes

It is instructed to:

- answer only from the retrieved evidence
- avoid inventing facts
- admit uncertainty if evidence is incomplete
- cite the chunk IDs that support the answer

## Why this RAG design is useful for meetings

Meeting transcripts are messy:

- caption fragments can be incomplete
- different speakers are interleaved
- users ask semantic questions, not just keyword matches

This architecture improves quality by:

- preserving speaker and timestamp context
- using summary + notes + transcript together
- handling both semantic and exact-match queries
- retrieving surrounding discussion, not isolated fragments

## Bonus features introduced beyond the basic MVP

On top of the base assignment flow, this project also includes:

- login and signup system
- per-user meeting history
- persistent session storage
- AWS S3 / GCP artifact mirroring
- editable summaries
- editable meeting title and notes
- `TXT` and `PDF` export
- contextualized hybrid RAG chatbot
- speaker-aware and timeline-aware query routing

## Storage model

The app persists artifacts locally first and can mirror them to cloud storage.

Artifacts stored:

- `users/users.json`
- `sessions/<session-id>.json`
- `rag/<session-id>.json`

Cloud mirroring supports:

- AWS S3
- GCP Cloud Storage

If both are configured, AWS S3 is preferred.

## Run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you need.

### Core app

```env
AUTH_SECRET=change-me-to-a-long-random-string
DATA_ROOT=
GOOGLE_GENERATIVE_AI_API_KEY=
OPENAI_API_KEY=
```

### Meet bot

```env
MEET_BOT_MODE=captions
MEET_BOT_NAME=Meet AI Scribe
MEET_BOT_HEADLESS=false
MEET_ALLOW_MANUAL_LOGIN=true
MEET_MANUAL_LOGIN_TIMEOUT_MS=180000
MEET_FIRST_CAPTION_TIMEOUT_MS=45000
MEET_CAPTION_CAPTURE_MS=90000
MEET_CAPTION_POLL_MS=1500
MEET_CAPTION_IDLE_TIMEOUT_MS=15000
PLAYWRIGHT_BOT_SERVICE_URL=
PLAYWRIGHT_BOT_SERVICE_TOKEN=
GOOGLE_ACCOUNT_EMAIL=
GOOGLE_ACCOUNT_PASSWORD=
GOOGLE_ACCOUNT_STORAGE_STATE_JSON=
GOOGLE_ACCOUNT_STORAGE_STATE_BASE64=
GOOGLE_ACCOUNT_STORAGE_STATE_PATH=playwright/.auth/google-meet.json
CHROME_EXECUTABLE_PATH=
```

### AWS S3 mirror

For Netlify, use the `S3_*` names below.

```env
S3_REGION=ap-south-1
S3_BUCKET=your-bucket-name
S3_PREFIX=meet-ai-scribe
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_SESSION_TOKEN=
```

Netlify reserves some `AWS_*` variables, so the hosted app uses `S3_*` names instead. The code still accepts AWS-native names as local fallbacks.

### GCP Cloud Storage mirror

```env
GCP_PROJECT_ID=
GCP_STORAGE_BUCKET=
GCP_STORAGE_PREFIX=meet-ai-scribe
GCP_SERVICE_ACCOUNT_KEY_JSON=
GCP_SERVICE_ACCOUNT_KEY_BASE64=
```

## Deployment

### Netlify

Recommended hosted-safe configuration:

```env
DATA_ROOT=/tmp/meet-ai-scribe
MEET_BOT_MODE=mock
```

Suggested Netlify flow:

1. Push the repo to GitHub.
2. Import it into Netlify.
3. Add environment variables in the Netlify dashboard.
4. Deploy.
5. Keep the public deployment in `mock` mode unless the real Meet bot is hosted in a more suitable runtime.

### Firebase App Hosting

The repo also includes `apphosting.yaml` for Firebase App Hosting preparation.

Suggested flow:

```bash
firebase login
firebase init apphosting
firebase apphosting:backends:create --project YOUR_PROJECT_ID
firebase apphosting:secrets:set AUTH_SECRET
firebase apphosting:secrets:set GOOGLE_GENERATIVE_AI_API_KEY
```

### Render Playwright bot service

This repo includes a dedicated Playwright bot service for Render:

- service entrypoint: `services/playwright-bot/server.ts`
- Docker image: [Dockerfile.playwright-bot](/Users/shivanshmundra/Downloads/Summariser_bot/Dockerfile.playwright-bot)
- optional Render blueprint: [render.playwright-bot.yaml](/Users/shivanshmundra/Downloads/Summariser_bot/render.playwright-bot.yaml)

Service endpoints:

- `GET /health`
- `POST /capture`

Recommended split architecture:

```text
Netlify frontend + API
        |
        v
PLAYWRIGHT_BOT_SERVICE_URL
        |
        v
Render Playwright bot service
        |
        v
Google Meet automation + caption capture
```

How to use it:

1. Deploy the bot service to Render using `Dockerfile.playwright-bot`.
2. Add bot env vars in Render:
   - `MEET_BOT_HEADLESS=true`
   - `MEET_BOT_NAME`
   - `MEET_ALLOW_MANUAL_LOGIN=false`
   - `MEET_FIRST_CAPTION_TIMEOUT_MS`
   - `MEET_CAPTION_CAPTURE_MS`
   - `MEET_CAPTION_POLL_MS`
   - `MEET_CAPTION_IDLE_TIMEOUT_MS`
   - `GOOGLE_ACCOUNT_EMAIL`
   - `GOOGLE_ACCOUNT_PASSWORD`
   - `GOOGLE_ACCOUNT_STORAGE_STATE_BASE64`
   - `GOOGLE_ACCOUNT_STORAGE_STATE_PATH=/tmp/google-meet.json`
   - optionally `PLAYWRIGHT_BOT_SERVICE_TOKEN`
3. Add `PLAYWRIGHT_BOT_SERVICE_URL` to Netlify and point it to the Render service URL.
4. Keep `MEET_BOT_MODE=captions` in the Netlify app only when the remote bot is ready.

When `PLAYWRIGHT_BOT_SERVICE_URL` is set, the app sends Meet capture to the remote Render bot service instead of launching Playwright inside the Netlify runtime.

To bootstrap an already authenticated Google session into Render:

1. Sign in locally once until [google-meet.json](/Users/shivanshmundra/Downloads/Summariser_bot/playwright/.auth/google-meet.json) is created.
2. Base64-encode that file.
3. Store the encoded value in Render as `GOOGLE_ACCOUNT_STORAGE_STATE_BASE64`.
4. Set `GOOGLE_ACCOUNT_STORAGE_STATE_PATH=/tmp/google-meet.json`.

At startup, the bot service automatically recreates the Playwright storage-state file from the secret so the remote bot can reuse your saved Google auth state.

## API overview

Main routes:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/[sessionId]`
- `PATCH /api/sessions/[sessionId]`
- `POST /api/sessions/[sessionId]/chat`

Temporary debugging route used during cloud storage setup:

- `GET /api/debug/storage`
- `POST /api/debug/storage`

This route can be removed before final polishing if you no longer need storage diagnostics.

## Project structure

```text
app/
  api/
    auth/
    sessions/
    debug/storage/
  page.tsx
  globals.css

components/
  auth-shell.tsx
  meet-scribe-app.tsx

lib/
  auth.ts
  meet-bot.ts
  google-meet-bot.ts
  summary.ts
  gemini-summary.ts
  meeting-rag.ts
  meeting-chat.ts
  session-store.ts
  aws-storage.ts
  gcp-storage.ts
  cloud-artifact-storage.ts
  export-session.ts
  data-root.ts
  types.ts
```

## Real bot notes

- The first Google sign-in can require manual verification.
- `MEET_BOT_HEADLESS=false` is easier for the first real Meet test.
- Captions are intentionally the primary capture path because audio routing is more fragile in cloud environments.
- Caption scraping still depends on Google Meet UI behavior, so selectors may need updates if Meet changes significantly.

## Recommended demo flow

For the smoothest demo:

1. Sign up or log in.
2. Start a `mock` session.
3. Show the generated transcript and structured summary.
4. Edit the meeting title or notes.
5. Ask the chatbot a question.
6. Download the summary as `TXT` or `PDF`.
7. Show the mirrored artifacts in AWS S3.

## Status

This project now covers the main assignment flow plus several bonus features:

- live public app deployment
- user authentication
- cloud storage integration
- editable summaries and notes
- export support
- contextualized hybrid RAG chatbot
