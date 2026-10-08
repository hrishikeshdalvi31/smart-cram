# Smart Cram

A study app for question papers, cheatsheets, AI explanations, flashcards, and educational videos. The Node.js backend provides account authentication, per-user SQLite storage, and server-side Gemini and YouTube API requests.

## Run locally

1. Install **Node.js 22.13 or newer** (the project uses built-in `node:sqlite`). No npm dependencies or database installation are required.
2. Copy `.env.example` to `.env` in the project folder. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Optionally fill in `GEMINI_API_KEY` and `YOUTUBE_API_KEY` in `.env`. Enable the YouTube Data API v3 for the YouTube key. `GEMINI_MODEL` is configurable for models available to your account. Account creation and notes work without either key; AI and video features show a configuration error until keys are set.
4. Start the app:

   ```sh
   npm start
   ```

5. Open **http://localhost:3000**, choose **Create an account**, and register with a name, email, and password of at least eight characters.

Use the server URL, rather than opening `index.html` directly or using Live Server. If changing the port or hostname, update `PORT` and `APP_ORIGIN` together and open that exact origin. `HOST` defaults to the local machine only.

The optional textbook is not included. Place `NCERT-Class-10-History.pdf` in the project folder to enable the textbook viewer. Question-paper JSON files are included. Some existing browser features load libraries and icons from CDNs and need internet access.

## Accounts and persistence

- SQLite stores accounts, sessions, notes, chat history, generated flashcards, and the current flashcard position in `data/smart-cram.sqlite` by default.
- Passwords are salted and hashed with scrypt. Random session tokens are sent in HttpOnly, SameSite cookies; only token hashes are stored in SQLite. Sessions expire after seven days.
- Logging out invalidates the session and clears the displayed account state. **Server data is preserved** so it returns at the next login. Removing notes or clearing chat is saved to the account.
- The save indicator shows pending or failed saves. On failure, use **Retry save** or **Download backup** before leaving. Closing the page while a save is pending may lose that unsaved edit.
- Concurrent tabs use revision checks: an outdated tab cannot silently overwrite newer data. On a conflict, download a backup, reload, and reapply the changes you need.
- If the browser has data from the old localStorage version, **Import old browser data** offers an explicit import into the signed-in account. It appends the old data and removes the old local copy only after a successful server save. Do this once, in the intended account.

Database files and `.env` are ignored by Git. Back up the database with the server stopped (including any SQLite sidecar files present). Do not delete the database unless you intend to remove all local accounts and saved data.

## API

All mutation requests require `Content-Type: application/json`. Protected routes use the session cookie; no user ID is accepted for selecting someone else's data. Errors return `{ "error": "A readable message" }`.

| Method | Route | Purpose / request |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | `{ name, email, password }`; creates account and session |
| POST | `/api/auth/login` | `{ email, password }`; creates session |
| GET | `/api/auth/me` | Current account |
| POST | `/api/auth/logout` | `{}`; invalidates session |
| GET | `/api/data` | Study data plus `revision` |
| PUT | `/api/data` | `{ cheatsheets, chatMessages, generatedFlashcards, progress, revision }`; atomically saves account data |
| GET | `/api/cheatsheets` | Cheatsheets plus `revision` |
| POST | `/api/cheatsheets` | `{ cheatsheet: { name, items: [] }, revision }`; appends a cheatsheet |
| POST | `/api/chat` | `{ message, systemPrompt? }`; returns `{ reply }` |
| POST | `/api/flashcards/generate` | `{ content }`; returns `{ flashcards: [{ question, answer }] }` |
| GET | `/api/youtube/search?q=topic` | Returns `{ videos }` |

The frontend saves chat responses and generated cards through `/api/data`; the generation endpoints do not independently save them. Chat prompts are currently single-turn. Revision conflicts return 409, invalid input 400, unauthenticated access 401, and missing provider keys 503. Requests have a 2 MB limit. Authentication is limited to 20 attempts per IP per 15 minutes; provider calls to 30 per account per minute. Limits are local to one server process and reset when it restarts.

## Verification

```sh
npm test
npm run check
```

The automated tests use temporary databases and mocked provider responses. They cover registration, login, logout, account isolation, database persistence across restarts, revision conflicts, data deletion, input checks, origin protection, private-file protection, and provider proxy responses/errors. Frontend persistence tests check ordered saves, retries, and conflict recovery. They do not call paid APIs or require real keys. GitHub Actions runs these checks on pushes and pull requests.

Manual checks:

1. Register, create a cheatsheet, add a note, and wait for **Saved**. Refresh and check the note.
2. Log out and back in. Check the same data returns; register another account and verify it starts empty.
3. With server keys configured, send a chat message, generate cards from a cheatsheet, and search videos. Refresh to check chat/cards persist.
4. Clear chat or delete a note, wait for **Saved**, and refresh.
5. Edit the same account in two tabs. Confirm the outdated tab reports a conflict rather than overwriting the first tab's edits.

## Deployment notes

This is a single-server backend suitable for local development and the lab demonstration. For deployment, use a Node host with persistent disk (GitHub Pages cannot run this server), HTTPS, `COOKIE_SECURE=true`, and the exact public `APP_ORIGIN`. Put it behind a reverse proxy; the app intentionally does not trust forwarded IP headers. Review operational limits before wider use. Email verification, password reset, and multi-server rate limiting are not implemented.

Only explicitly listed public assets are served. API keys stay on the server. Do not add server files, databases, or `.env` to the static asset list. Provider API references: [Gemini content generation](https://ai.google.dev/api/generate-content), [YouTube search](https://developers.google.com/youtube/v3/docs/search/list).

## Contributing this change

This backend addresses [issue #1](https://github.com/hrishikeshdalvi31/smart-cram/issues/1), and moves provider keys out of the frontend as required for that issue.

If your working folder was downloaded as a ZIP, it has no Git history. Fork the original repository under your own GitHub account, clone your fork into a separate folder, and create a branch such as `feature/backend`. Copy the changed source files, `.gitignore`, `.env.example`, `package.json`, this README, `test/`, and `.github/workflows/test.yml` into that checkout. Do not copy `.env`, `data/`, or test accounts. Run the checks there, review the diff, commit, push your branch, and open a pull request against the original repository. Include `Fixes #1` in the PR description and distinguish mocked API tests from live API checks.
