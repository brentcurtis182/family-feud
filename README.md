# Family Feud — Game Night Edition

A real-time, multi-device Family Feud game. The host runs the show on a laptop/tablet,
a TV shows the board, and phones act as team buzzers.

- **Host** screen: runs the game (rosters, questions, face-off, reveals, scoring, Fast Money)
- **Game Screen** (TV): the big animated board
- **Players**: phones join a team and buzz
- **Judge** (optional, host-only mode): a second person adjudicates answers

## Tech
Node + Express + Socket.IO, vanilla JS/CSS front end. AI questions via the Anthropic
API (with an offline bank fallback). Fast Money voice transcription via a cloud STT
provider (Groq or OpenAI).

## Run locally
```bash
npm install
cp .env.example .env   # fill in keys (all optional — app runs without them)
npm start              # http://localhost:3000
```
Open the host on a laptop, the TV/Game Screen in a browser, and phones as players —
all on the same network (or the deployed HTTPS URL).

## Environment variables
See `.env.example`. All are optional:
- `ANTHROPIC_API_KEY` — AI question generation (falls back to the offline bank)
- `STT_PROVIDER` (`groq` | `openai`) + `GROQ_API_KEY` / `OPENAI_API_KEY` — Fast Money voice transcription
- `PORT` — set automatically by Railway

> Note: microphone features (Fast Money voice) require **HTTPS** (or `localhost`).
> They work on the deployed site and on `localhost`, but not over a plain-HTTP LAN IP.

## Deploy (Railway)
1. Push this repo to GitHub.
2. Railway → New Project → Deploy from GitHub repo.
3. Add the environment variables above in the Railway service settings.
4. Add the custom domain and point DNS at Railway.

Start command: `npm start` (also in `Procfile`). Railway sets `PORT` automatically.

## Tests
```bash
npm run test:fixes      # passcode / rosters / run-it-back / multipliers / stakes
npm run test:lineup     # face-off rotation, host override, roster-edit pointer
npm run test:phase3..8  # reveal, face-off, round loop, AI, judge, fast money
node test-rejoin.js     # reconnection
```
(Tests need the dev dependency `socket.io-client` and a running server on :3000.)
