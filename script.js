// LocalStorage Persistence Helpers for Smart Cram (Phase 1)
const STORAGE_KEY = 'smart_cram_state_v1';

function saveStateToStorage() {
  try {
    const serializedState = JSON.stringify({
      cheatsheets: state.cheatsheets || [],
      chatMessages: state.chatMessages || [],
      generatedFlashcards: state.generatedFlashcards || []
    });
    localStorage.setItem(STORAGE_KEY, serializedState);
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
}

function loadStateFromStorage() {
  try {
    const serializedState = localStorage.getItem(STORAGE_KEY);
    if (!serializedState) return;
    const persisted = JSON.parse(serializedState);
    if (persisted.cheatsheets) state.cheatsheets = persisted.cheatsheets;
    if (persisted.chatMessages) state.chatMessages = persisted.chatMessages;
    if (persisted.generatedFlashcards) state.generatedFlashcards = persisted.generatedFlashcards;
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
  }
}

// Call loadStateFromStorage() during app initialization (e.g. DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  // Existing init code...
});

// Call saveStateToStorage() wherever state changes (e.g., creating/deleting cheatsheets, sending chat, generating flashcards)