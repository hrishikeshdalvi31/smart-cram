import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const deriveKey = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const emptyData = () => ({ cheatsheets: [], chatMessages: [], generatedFlashcards: [], progress: {} });

function string(value, name, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw fail(400, `${name} must contain ${min}–${max} characters.`);
  }
  return value;
}

function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Invalid study data.');
  for (const field of ['cheatsheets', 'chatMessages', 'generatedFlashcards']) {
    if (!Array.isArray(data[field]) || data[field].length > 2000) throw fail(400, `Invalid ${field}.`);
  }
  for (const sheet of data.cheatsheets) {
    string(sheet?.name, 'Cheatsheet name', 120);
    if (!Array.isArray(sheet.items) || sheet.items.length > 2000) throw fail(400, 'Invalid cheatsheet items.');
    for (const item of sheet.items) {
      string(item?.text, 'Note', 100000);
      string(item.source, 'Note source', 120);
      string(item.addedAt, 'Note date', 100);
    }
  }
  for (const message of data.chatMessages) {
    if (!['user', 'bot'].includes(message?.type)) throw fail(400, 'Invalid message type.');
    string(message.content, 'Message', 200000);
  }
  for (const card of data.generatedFlashcards) {
    string(card?.question, 'Question', 10000);
    string(card.answer, 'Answer', 100000);
  }
  const currentFlashcard = data.progress?.currentFlashcard ?? 0;
  if (!Number.isSafeInteger(currentFlashcard) || currentFlashcard < 0) throw fail(400, 'Invalid progress.');
  // Retain only the fields owned by this API.
  return { cheatsheets: data.cheatsheets, chatMessages: data.chatMessages,
    generatedFlashcards: data.generatedFlashcards, progress: { currentFlashcard } };
}

async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw fail(415, 'Send a JSON request body.');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw fail(413, 'Study data exceeds the 2 MB limit.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail(400, 'Invalid JSON body.'); }
}

/** A factory keeps tests isolated from real credentials and databases. */
export function createApp({ databasePath = process.env.DATABASE_PATH || resolve(root, 'data/smart-cram.sqlite'),
  origin = process.env.APP_ORIGIN || 'http://localhost:3000',
  secureCookie = process.env.COOKIE_SECURE === 'true',
  geminiKey = process.env.GEMINI_API_KEY || '', youtubeKey = process.env.YOUTUBE_API_KEY || '',
  geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash', fetchImpl = fetch } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
    );`);
  const limits = new Map();
  function limit(key, max, interval) {
    const now = Date.now();
    for (const [entry, bucket] of limits) if (bucket.until <= now) limits.delete(entry);
    const bucket = limits.get(key) || { count: 0, until: now + interval };
    limits.set(key, bucket);
    if (++bucket.count > max) throw fail(429, 'Too many requests. Please try again later.');
  }
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('smart_cram_session='))?.slice(19);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE token_hash=? AND expires_at>?`).get(hash(token), Date.now());
  }
  function cookie(res, token, age) {
    res.setHeader('Set-Cookie', `smart_cram_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie ? '; Secure' : ''}`);
  }
  function revoke(req) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('smart_cram_session='))?.slice(19);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
  }
  function getData(userId) {
    const row = db.prepare('SELECT data,revision FROM study_data WHERE user_id=?').get(userId);
    return { ...JSON.parse(row.data), revision: row.revision };
  }
  function writeData(userId, data, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw fail(400, 'A valid revision is required.');
    const serialized = JSON.stringify(validateData(data));
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw fail(413, 'Study data exceeds the 2 MB limit.');
    const result = db.prepare('UPDATE study_data SET data=?, revision=revision+1 WHERE user_id=? AND revision=?')
      .run(serialized, userId, revision);
    if (!result.changes) throw fail(409, 'Your data changed in another tab. Save a backup of your edits before reloading.');
    return { revision: revision + 1 };
  }
  async function upstream(url, options, service) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) }); }
    catch { throw fail(502, `${service} is unavailable or timed out. Please try again.`); }
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) throw fail(502, `${service} rejected the request. Check the server API key, model, and API access.`);
      if (response.status === 429) throw fail(503, `${service} quota exceeded. Please try again later.`);
      throw fail(502, `${service} is unavailable. Please try again.`);
    }
    try { return await response.json(); } catch { throw fail(502, `${service} returned an invalid response.`); }
  }
  async function generate(message, systemPrompt) {
    if (!geminiKey) throw fail(503, 'AI is not configured. Set GEMINI_API_KEY on the server.');
    const data = await upstream(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: message }] }],
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) })
    }, 'Gemini');
    const reply = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!reply) throw fail(502, 'AI returned no text. Try rephrasing your request.');
    return reply;
  }
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ['/script.js', ['script.js', 'text/javascript']], ['/account.js', ['account.js', 'text/javascript']],
    ['/styles.css', ['styles.css', 'text/css']],
    ['/2023-24_history.json', ['2023-24_history.json', 'application/json']],
    ['/2024-25_history.json', ['2024-25_history.json', 'application/json']],
    ['/NCERT-Class-10-History.pdf', ['NCERT-Class-10-History.pdf', 'application/pdf']]
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        const file = staticFiles.get(path);
        if (!file || !['GET', 'HEAD'].includes(req.method)) throw fail(404, 'Not found.');
        let content;
        try { content = readFileSync(resolve(root, file[0])); } catch { throw fail(404, 'File not found.'); }
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      // JSON-only mutations plus same-origin checks prevent cross-site cookie use.
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) {
        throw fail(403, 'Use the application from its configured APP_ORIGIN.');
      }
      if (path === '/api/health' && req.method === 'GET') return json(200, { ok: true });
      if (['/api/auth/register', '/api/auth/login'].includes(path) && req.method === 'POST') {
        limit(`auth:${req.socket.remoteAddress}`, 20, 15 * 60000);
        const body = await readJson(req);
        const email = string(body.email, 'Email', 254).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
        const password = string(body.password, 'Password', 128, 8);
        let user;
        if (path.endsWith('/register')) {
          const name = string(body.name, 'Name', 80).trim();
          const salt = randomBytes(16).toString('hex');
          const derived = await deriveKey(password, salt, 64);
          db.exec('BEGIN');
          try {
            const inserted = db.prepare('INSERT INTO users(name,email,salt,password_hash) VALUES(?,?,?,?)').run(name, email, salt, derived.toString('hex'));
            db.prepare('INSERT INTO study_data(user_id,data) VALUES(?,?)').run(inserted.lastInsertRowid, JSON.stringify(emptyData()));
            db.exec('COMMIT');
            user = { id: Number(inserted.lastInsertRowid), name, email };
          } catch (error) {
            db.exec('ROLLBACK');
            if (String(error.message).includes('UNIQUE')) throw fail(409, 'An account with that email already exists.');
            throw error;
          }
        } else {
          const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          const derived = await deriveKey(password, row?.salt || 'invalid-account', 64);
          if (!row || !timingSafeEqual(derived, Buffer.from(row.password_hash, 'hex'))) throw fail(401, 'Incorrect email or password.');
          user = { id: row.id, name: row.name, email: row.email };
        }
        revoke(req);
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 7 * 86400000);
        cookie(res, token, 7 * 86400);
        return json(path.endsWith('/register') ? 201 : 200, { user });
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        await readJson(req); revoke(req); cookie(res, '', 0); return json(200, { ok: true });
      }
      const user = session(req);
      if (!user) throw fail(401, 'Please sign in to continue.');
      if (req.headers['x-account-id'] && req.headers['x-account-id'] !== String(user.id)) {
        throw fail(409, 'The signed-in account changed in another tab. Download a backup of unsaved edits and reload.');
      }
      if (path === '/api/auth/me' && req.method === 'GET') return json(200, { user });
      if (path === '/api/data' && req.method === 'GET') return json(200, getData(user.id));
      if (path === '/api/data' && req.method === 'PUT') {
        const body = await readJson(req);
        return json(200, writeData(user.id, body, body.revision));
      }
      if (path === '/api/cheatsheets' && req.method === 'GET') {
        const data = getData(user.id); return json(200, { cheatsheets: data.cheatsheets, revision: data.revision });
      }
      if (path === '/api/cheatsheets' && req.method === 'POST') {
        const body = await readJson(req);
        const data = getData(user.id);
        data.cheatsheets.push(body.cheatsheet);
        return json(201, writeData(user.id, data, body.revision));
      }
      if (path === '/api/chat' && req.method === 'POST') {
        limit(`provider:${user.id}`, 30, 60000);
        const body = await readJson(req);
        const message = string(body.message, 'Message', 150000);
        const prompt = body.systemPrompt == null ? 'You are a helpful study assistant.' : string(body.systemPrompt, 'System prompt', 10000);
        return json(200, { reply: await generate(message, prompt) });
      }
      if (path === '/api/flashcards/generate' && req.method === 'POST') {
        limit(`provider:${user.id}`, 30, 60000);
        const body = await readJson(req);
        const content = string(body.content, 'Cheatsheet content', 150000);
        const reply = await generate(content, 'Create at least 10 concise flashcards for active recall from this content. Return only pairs in the format Q: question followed by A: answer, with each Q: on a new line.');
        const flashcards = [...reply.matchAll(/Q:\s*(.+?)\s*A:\s*(.+?)(?=\nQ:|$)/gs)].map(pair => ({ question: pair[1].trim(), answer: pair[2].trim() }));
        if (!flashcards.length) throw fail(502, 'AI returned no valid flashcards. Please try again.');
        return json(200, { flashcards });
      }
      if (path === '/api/youtube/search' && req.method === 'GET') {
        limit(`provider:${user.id}`, 30, 60000);
        const topic = string(url.searchParams.get('q'), 'Search topic', 200);
        if (!youtubeKey) throw fail(503, 'Video search is not configured. Set YOUTUBE_API_KEY on the server.');
        const params = new URLSearchParams({ part: 'snippet', q: `${topic} educational tutorial`, type: 'video', videoDuration: 'medium', videoEmbeddable: 'true', maxResults: '5', relevanceLanguage: 'en', key: youtubeKey });
        const data = await upstream(`https://www.googleapis.com/youtube/v3/search?${params}`, {}, 'YouTube');
        const videos = (data.items || []).filter(item => /^[\w-]{11}$/.test(item.id?.videoId)).map(item => ({
          id: item.id.videoId, title: item.snippet.title, description: item.snippet.description,
          thumbnail: `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
          channelTitle: item.snippet.channelTitle, publishedAt: item.snippet.publishedAt
        }));
        return json(200, { videos });
      }
      throw fail(404, 'API endpoint not found.');
    } catch (error) {
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' });
      else res.end();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp();
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Smart Cram is running at ${process.env.APP_ORIGIN || 'http://localhost:3000'}`));
}
