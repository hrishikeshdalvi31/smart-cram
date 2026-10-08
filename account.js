// Authentication and server persistence for the existing study interface.
let currentUser = null;
let dataRevision = 0;
let saveQueue = Promise.resolve();
let unsavedData = null;
let accountReady = false;
let registering = false;
let providerRequests = 0;

async function apiRequest(path, options = {}) {
  const isProvider = ['/api/chat', '/api/flashcards/generate', '/api/youtube/search'].some(route => path.startsWith(route));
  if (isProvider) providerRequests++;
  try {
  const response = await fetch(path, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json',
      ...(currentUser && !path.startsWith('/api/auth/') ? { 'X-Account-Id': String(currentUser.id) } : {}), ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
  } finally { if (isProvider) providerRequests--; }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function studySnapshot() {
  return { cheatsheets: state.cheatsheets, chatMessages: state.chatMessages,
    generatedFlashcards: state.generatedFlashcards, progress: { currentFlashcard: state.currentFlashcard } };
}

function setSyncStatus(message, failed = false) {
  document.getElementById('sync-status').textContent = message;
  document.getElementById('retry-save').hidden = !failed;
  document.getElementById('backup-data').hidden = !failed;
}

function saveUserData() {
  if (!accountReady) return saveQueue;
  const snapshot = JSON.stringify(studySnapshot());
  unsavedData = snapshot;
  setSyncStatus('Saving…');
  // Serialize writes so slower responses cannot overwrite newer edits.
  saveQueue = saveQueue.then(async () => {
    try {
      const result = await apiRequest('/api/data', { method: 'PUT', body: JSON.stringify({ ...JSON.parse(snapshot), revision: dataRevision }) });
      dataRevision = result.revision;
      if (unsavedData === snapshot) { unsavedData = null; setSyncStatus('Saved'); }
    } catch (error) {
      setSyncStatus(`Not saved: ${error.message}`, true);
    }
  });
  return saveQueue;
}

function downloadStudyBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(studySnapshot(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'smart-cram-backup.json'; link.click();
  URL.revokeObjectURL(url);
}

async function loadUserData() {
  const data = await apiRequest('/api/data');
  dataRevision = data.revision;
  state.cheatsheets = data.cheatsheets;
  state.chatMessages = data.chatMessages.length ? data.chatMessages : [{ type: 'bot', content: "Hello! I'm your AI study assistant. How can I help you today?" }];
  state.generatedFlashcards = data.generatedFlashcards;
  state.currentFlashcard = Math.min(data.progress?.currentFlashcard || 0, Math.max(0, state.generatedFlashcards.length - 1));
  updateCheatsheetsDropdown(); updateChatMessages();
  accountReady = true;
  setSyncStatus('Saved');
}

function showAuth(message = '') {
  document.getElementById('app-content').inert = true;
  document.getElementById('auth-panel').hidden = false;
  document.getElementById('auth-error').textContent = message;
}

async function finishSignIn(user) {
  currentUser = user;
  await loadUserData();
  document.querySelector('.profile-name').textContent = user.name;
  document.querySelector('.profile-email').textContent = user.email;
  document.getElementById('auth-panel').hidden = true;
  document.getElementById('app-content').inert = false;
  document.getElementById('auth-password').value = '';
  // Older anonymous data is imported only when the user explicitly requests it.
  try { document.getElementById('import-local').hidden = !localStorage.getItem('smart_cram_user_data'); } catch {}
}

async function initializeAccount() {
  showAuth();
  try {
    const { user } = await apiRequest('/api/auth/me');
    await finishSignIn(user);
  } catch (error) {
    showAuth(error.status === 401 ? '' : `Could not load your account: ${error.message}`);
  }
}

function toggleAuthMode() {
  registering = !registering;
  document.getElementById('auth-title').textContent = registering ? 'Create your account' : 'Welcome to Smart Cram';
  document.getElementById('auth-name-label').hidden = !registering;
  document.getElementById('auth-name').required = registering;
  document.getElementById('auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  document.getElementById('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  document.getElementById('auth-toggle').textContent = registering ? 'Already have an account? Sign in' : 'New here? Create an account';
  document.getElementById('auth-error').textContent = '';
}

async function submitAuth(event) {
  event.preventDefault();
  const button = document.getElementById('auth-submit');
  button.disabled = true;
  document.getElementById('auth-error').textContent = '';
  try {
    const { user } = await apiRequest(`/api/auth/${registering ? 'register' : 'login'}`, {
      method: 'POST', body: JSON.stringify({ name: document.getElementById('auth-name').value,
        email: document.getElementById('auth-email').value, password: document.getElementById('auth-password').value })
    });
    await finishSignIn(user);
  } catch (error) { document.getElementById('auth-error').textContent = error.message; }
  finally { button.disabled = false; }
}

async function importLocalData() {
  if (!confirm('Import this browser’s old notes, chat, and flashcards into the account currently signed in?')) return;
  try {
    const raw = localStorage.getItem('smart_cram_user_data');
    if (!raw) return;
    const legacy = JSON.parse(raw);
    if (!['cheatsheets', 'chatMessages', 'generatedFlashcards'].every(key => Array.isArray(legacy[key]))) throw new Error('The old data is not in a supported format.');
    state.cheatsheets.push(...legacy.cheatsheets);
    state.chatMessages.push(...legacy.chatMessages);
    state.generatedFlashcards.push(...legacy.generatedFlashcards);
    updateCheatsheetsDropdown(); updateChatMessages();
    document.getElementById('import-local').hidden = true;
    await saveUserData();
    if (!unsavedData) localStorage.removeItem('smart_cram_user_data');
  } catch (error) { alert(`Import failed: ${error.message}`); }
}

async function logout() {
  if (providerRequests) { alert('Please wait for your current AI or video request to finish before signing out.'); return; }
  await saveQueue;
  if (unsavedData) { alert('Your latest changes have not been saved. Retry saving or download a backup before leaving.'); return; }
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    accountReady = false;
    // A fresh page removes all rendered and in-memory data from this account.
    window.location.reload();
  } catch (error) { alert(`Could not sign out: ${error.message}`); }
}

window.addEventListener('beforeunload', event => {
  if (unsavedData) { event.preventDefault(); event.returnValue = ''; }
});
