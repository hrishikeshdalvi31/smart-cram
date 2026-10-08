import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function start(options = {}) {
  const app = createApp({ databasePath: ':memory:', ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers, body: await response.json().catch(() => null) };
  }
  const close = () => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); });
  return { app, request, close };
}
const credentials = { name: 'Student', email: 'student@example.com', password: 'test-password-123' };
const studyData = { cheatsheets: [{ name: 'History', items: [{ text: 'A note', source: 'PDF', addedAt: '2026-10-09' }] }],
  chatMessages: [{ type: 'user', content: 'Hello' }], generatedFlashcards: [{ question: 'Q', answer: 'A' }], progress: { currentFlashcard: 0 } };

test('registration, login, per-user storage, conflicts, deletion and logout', async t => {
  const { request, close } = await start(); t.after(close);
  assert.equal((await request('/api/data')).status, 401);
  const first = await request('/api/auth/register', { method: 'POST', body: credentials });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = first.cookie;
  assert.equal((await request('/api/auth/register', { method: 'POST', body: credentials })).status, 409);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'wrong-password' } })).status, 401);
  const saved = await request('/api/data', { method: 'PUT', cookie, body: { ...studyData, revision: 0 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual((await request('/api/data', { cookie })).body, { ...studyData, revision: 1 });
  assert.equal((await request('/api/data', { method: 'PUT', cookie, body: { ...studyData, revision: 0 } })).status, 409);
  const second = await request('/api/auth/register', { method: 'POST', body: { ...credentials, email: 'second@example.com' } });
  assert.deepEqual((await request('/api/cheatsheets', { cookie: second.cookie })).body.cheatsheets, []);
  assert.equal((await request('/api/data', { cookie: second.cookie, headers: { 'X-Account-Id': String(first.body.user.id) } })).status, 409);
  const forged = await request('/api/data', { method: 'PUT', cookie: second.cookie, body: { ...studyData, user_id: first.body.user.id, revision: 0 } });
  assert.equal(forged.status, 200);
  assert.equal((await request('/api/data', { cookie })).body.revision, 1);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await request('/api/data', { cookie })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: credentials });
  assert.deepEqual((await request('/api/data', { cookie: login.cookie })).body.cheatsheets, studyData.cheatsheets);
  assert.equal((await request('/api/data', { method: 'PUT', cookie: login.cookie, body: { ...studyData, cheatsheets: [], revision: 1 } })).status, 200);
  assert.deepEqual((await request('/api/cheatsheets', { cookie: login.cookie })).body.cheatsheets, []);
});

test('SQLite and sessions survive a server restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'smart-cram-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'study.sqlite');
  const first = await start({ databasePath });
  const auth = await first.request('/api/auth/register', { method: 'POST', body: credentials });
  await first.request('/api/data', { method: 'PUT', cookie: auth.cookie, body: { ...studyData, revision: 0 } });
  await first.close();
  const second = await start({ databasePath });
  try { assert.deepEqual((await second.request('/api/data', { cookie: auth.cookie })).body, { ...studyData, revision: 1 }); }
  finally { await second.close(); }
});

test('invalid inputs, cross-origin requests, private files and missing keys', async t => {
  const { request, close } = await start(); t.after(close);
  for (const path of ['/.env', '/server.js', '/data/smart-cram.sqlite', '/package.json', '/test/server.test.js']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: credentials, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: credentials, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { ...credentials, password: 'short' } })).status, 400);
  const { cookie } = await request('/api/auth/register', { method: 'POST', body: credentials });
  assert.equal((await request('/api/data', { method: 'PUT', cookie, body: { ...studyData, cheatsheets: [null], revision: 0 } })).status, 400);
  assert.equal((await request('/api/data', { method: 'PUT', cookie, body: { ...studyData, revision: -1 } })).status, 400);
  assert.equal((await request('/api/chat', { method: 'POST', cookie, body: { message: '' } })).status, 400);
  assert.equal((await request('/api/chat', { method: 'POST', cookie, body: { message: 'Hello' } })).status, 503);
  assert.equal((await request('/api/youtube/search?q=history', { cookie })).status, 503);
});

test('proxies use server keys and return chat, flashcards and videos', async t => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.includes('youtube') ? { items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'History', description: 'Lesson', channelTitle: 'School', publishedAt: '2026-01-01' } }] } :
      { candidates: [{ content: { parts: [{ text: 'Q: What is history?\nA: Study of the past.' }] } }] } };
  };
  const { request, close } = await start({ geminiKey: 'test-gemini-secret', youtubeKey: 'test-youtube-secret', fetchImpl }); t.after(close);
  const { cookie } = await request('/api/auth/register', { method: 'POST', body: credentials });
  const chat = await request('/api/chat', { method: 'POST', cookie, body: { message: 'Hello' } });
  assert.equal(chat.status, 200); assert.match(chat.body.reply, /history/);
  const cards = await request('/api/flashcards/generate', { method: 'POST', cookie, body: { content: 'Study notes' } });
  assert.deepEqual(cards.body.flashcards, [{ question: 'What is history?', answer: 'Study of the past.' }]);
  const videos = await request('/api/youtube/search?q=history', { cookie });
  assert.equal(videos.body.videos[0].id, 'abcdefghijk');
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini-secret');
  assert.match(calls[2].url, /key=test-youtube-secret/);
  assert.ok(!JSON.stringify([chat.body, cards.body, videos.body]).includes('secret'));
});

test('provider failures do not expose secrets', async t => {
  const { request, close } = await start({ geminiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 403 }) }); t.after(close);
  const { cookie } = await request('/api/auth/register', { method: 'POST', body: credentials });
  const result = await request('/api/chat', { method: 'POST', cookie, body: { message: 'Hello' } });
  assert.equal(result.status, 502); assert.match(result.body.error, /server API key/); assert.ok(!result.body.error.includes('secret'));
});
