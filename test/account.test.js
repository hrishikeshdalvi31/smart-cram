import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function client(fetch) {
  const elements = new Map();
  const context = vm.createContext({ fetch, console,
    state: { cheatsheets: [], chatMessages: [], generatedFlashcards: [], currentFlashcard: 0 },
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true });
      return elements.get(id);
    } }, window: { addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../account.js', import.meta.url), 'utf8'), context);
  vm.runInContext('accountReady = true; currentUser = { id: 42 };', context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test('browser saves are ordered, carry account identity and use the latest revision', async () => {
  const calls = [];
  const { run, elements } = client(async (path, options) => {
    calls.push({ path, ...options });
    return { ok: true, json: async () => ({ revision: calls.length }) };
  });
  await run(`state.chatMessages.push({type:'user', content:'first'}); saveUserData();
    state.chatMessages.push({type:'bot', content:'second'}); saveUserData();`);
  assert.deepEqual(calls.map(call => JSON.parse(call.body).revision), [0, 1]);
  assert.equal(JSON.parse(calls[0].body).chatMessages.length, 1);
  assert.equal(JSON.parse(calls[1].body).chatMessages.length, 2);
  assert.equal(calls[1].headers['X-Account-Id'], '42');
  assert.equal(elements.get('sync-status').textContent, 'Saved');
  assert.equal(run('unsavedData'), null);
});

test('failed saves remain available and a successful retry clears the warning', async () => {
  let fail = true;
  const { run, elements } = client(async () => {
    if (fail) throw new Error('Network unavailable');
    return { ok: true, json: async () => ({ revision: 1 }) };
  });
  await run('saveUserData()');
  assert.match(elements.get('sync-status').textContent, /Not saved/);
  assert.equal(elements.get('backup-data').hidden, false);
  assert.notEqual(run('unsavedData'), null);
  fail = false;
  await run('saveUserData()');
  assert.equal(run('unsavedData'), null);
  assert.equal(elements.get('backup-data').hidden, true);
});

test('conflicts retain unsaved edits and do not advance the revision', async () => {
  const { run, elements } = client(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed in another tab' }) }));
  await run('saveUserData()');
  assert.equal(run('dataRevision'), 0);
  assert.notEqual(run('unsavedData'), null);
  assert.match(elements.get('sync-status').textContent, /another tab/);
});
