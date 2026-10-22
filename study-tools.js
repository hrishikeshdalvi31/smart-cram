let libraryBooks = [];
let activeLibrarySection = null;
let textbookKey = '';
let textbookCleanup = Promise.resolve();

async function loadLibrary() {
  const data = await apiRequest('/api/library');
  libraryBooks = data.books;
  for (const book of libraryBooks) subjects[book.id] = { name: book.subject === 'English' ? `English · ${book.title}` : book.subject, icon: 'book', color: 'history-color' };
  populateSubjectsDropdown();
  const container = document.getElementById('book-library');
  container.replaceChildren();
  if (!libraryBooks.length) { container.textContent = 'Shared books have not been installed yet. You can upload a personal PDF from Subjects → History.'; return; }
  for (const book of libraryBooks) {
    const button = document.createElement('button'); button.className = 'book-card';
    const subject = document.createElement('span'); subject.className = 'book-subject'; subject.textContent = book.subject;
    const title = document.createElement('strong'); title.textContent = book.title;
    const detail = document.createElement('span'); detail.textContent = `${book.sections.length} sections · ${book.sections.reduce((sum, section) => sum + section.pages, 0)} pages`;
    const action = document.createElement('span'); action.className = 'book-action'; action.textContent = 'Open book →';
    button.append(subject, title, detail, action); button.onclick = () => selectSubject(book.id); container.append(button);
  }
}
function currentLibraryBook() { return libraryBooks.find(book => book.id === state.selectedSubject); }
function resetTextbook() {
  ++renderVersion;
  const old = textbookDocument;
  textbookDocument = null; textbookLoad = null; textbookKey = ''; textbookPage = 1;
  textbookNavigationBusy = false; updateTextbookNavigation();
  if (old) textbookCleanup = textbookCleanup.then(() => old.loadingTask.destroy()).catch(() => {});
  document.querySelector('#highlight-overlay')?.remove();
  state.currentHighlightData = null;
}
function selectDefaultSection(subjectId) {
  const book = libraryBooks.find(book => book.id === subjectId);
  activeLibrarySection = book?.sections.find(section => section.group === 'Chapters')?.id || book?.sections[0]?.id || null;
  resetTextbook();
}
function renderLibraryNavigation() {
  const book = currentLibraryBook();
  const nav = document.getElementById('library-navigation');
  nav.hidden = !book || !activeLibrarySection;
  document.getElementById('shared-textbook').hidden = !book || !!activeLibrarySection;
  if (!book || !activeLibrarySection) { document.getElementById('pdf-title').textContent = 'Personal / legacy textbook'; return; }
  const select = document.getElementById('library-section'); select.replaceChildren();
  const groups = new Map();
  for (const section of book.sections) {
    if (!groups.has(section.group)) { const group = document.createElement('optgroup'); group.label = section.group; groups.set(section.group, group); select.append(group); }
    const option = document.createElement('option'); option.value = section.id;
    const chapterNumber = book.sections.filter(item => item.group === 'Chapters').findIndex(item => item.id === section.id) + 1;
    option.textContent = `${section.group === 'Chapters' ? `${chapterNumber}. ` : ''}${section.title}`;
    groups.get(section.group).append(option);
  }
  select.value = activeLibrarySection;
  const index = book.sections.findIndex(section => section.id === activeLibrarySection);
  const section = book.sections[index];
  document.getElementById('pdf-title').textContent = section.title;
  document.getElementById('section-summary').textContent = `Section ${index + 1} of ${book.sections.length} · ${section.pages} pages`;
  document.getElementById('previous-section').disabled = index === 0;
  document.getElementById('next-section').disabled = index === book.sections.length - 1;
  document.getElementById('study-title').textContent = `${book.title}${state.selectedPaper ? ` · ${state.selectedPaper} paper` : ''}`;
}
function selectLibrarySection(id) {
  if (!currentLibraryBook()?.sections.some(section => section.id === id)) return;
  activeLibrarySection = id; resetTextbook(); renderLibraryNavigation(); renderTextbookPage(1);
}
function stepLibrarySection(step) {
  const book = currentLibraryBook();
  const next = book?.sections[book.sections.findIndex(section => section.id === activeLibrarySection) + step];
  if (next) selectLibrarySection(next.id);
}
function useSharedTextbook() { selectDefaultSection(state.selectedSubject); renderLibraryNavigation(); renderTextbookPage(1); }
function currentTextbookSource() {
  const book = currentLibraryBook(); const section = book?.sections.find(section => section.id === activeLibrarySection);
  return section ? `${`${book.title}: ${section.title}`.slice(0, 95)} (PDF page ${textbookPage})` : `Personal PDF (page ${textbookPage})`;
}

// Study controls shared by the textbook, cheatsheets, and progress dashboard.
let serviceStatus = { ai: false, videos: false, textbook: false };
let textbookDocument = null;
let textbookPage = 1;
let textbookLoad = null;
let textbookNavigationBusy = false;
let pdfLibraryLoad = null;
let renderVersion = 0;
let textbookSearchVersion = 0;
let editorAction = null;
let chatBusy = false;
let flashcardsBusy = false;

function updateTextbookNavigation() {
  const previous = document.getElementById('previous-page');
  const next = document.getElementById('next-page');
  if (!previous || !next) return;
  previous.disabled = textbookNavigationBusy || !textbookDocument || textbookPage <= 1;
  next.disabled = textbookNavigationBusy || !textbookDocument || textbookPage >= textbookDocument.numPages;
}

function navigateTextbookPage(step) {
  const page = textbookPage + step;
  if (textbookNavigationBusy || !textbookDocument || page < 1 || page > textbookDocument.numPages) return;
  return renderTextbookPage(page);
}

async function refreshServices() {
  serviceStatus = await apiRequest('/api/services');
  const status = document.getElementById('service-status');
  status.textContent = [serviceStatus.ai ? 'AI key configured' : 'AI needs a server key', serviceStatus.videos ? 'Video key configured' : 'Videos need a server key', serviceStatus.textbook ? 'Textbook ready' : 'No textbook available'].join(' · ');
}

function renderProgress() {
  const element = document.getElementById('study-progress');
  if (element) element.textContent = `${state.cheatsheets.length} cheatsheets · ${state.generatedFlashcards.length} flashcards · ${(state.completedQuestions || []).length} questions studied`;
}

function questionProgressKey(id) { return `${state.selectedSubject}/${state.selectedPaper}/${id}`; }
function toggleQuestionStudied(id) {
  const key = questionProgressKey(id);
  state.completedQuestions = (state.completedQuestions || []).includes(key)
    ? state.completedQuestions.filter(value => value !== key) : [...(state.completedQuestions || []), key];
  updateQuestionsPanel(); renderProgress(); saveUserData();
}

function openEditor(title, firstLabel, firstValue, secondLabel, secondValue, action) {
  document.getElementById('editor-title').textContent = title;
  document.getElementById('editor-first-label').textContent = firstLabel;
  document.getElementById('editor-first').value = firstValue;
  document.getElementById('editor-second-label').textContent = secondLabel || '';
  document.getElementById('editor-second-wrap').hidden = !secondLabel;
  document.getElementById('editor-second').value = secondValue || '';
  editorAction = action;
  document.getElementById('editor-modal').classList.remove('hidden');
  document.getElementById('editor-first').focus();
}
function closeEditor() { document.getElementById('editor-modal').classList.add('hidden'); editorAction = null; }
function submitEditor(event) {
  event.preventDefault();
  const first = document.getElementById('editor-first').value.trim();
  const second = document.getElementById('editor-second').value.trim();
  if (!first || (!document.getElementById('editor-second-wrap').hidden && !second)) { alert('Complete both fields.'); return; }
  if (editorAction?.(first, second) === false) return;
  closeEditor(); renderProgress(); saveUserData();
}

function editNote(index = null) {
  const sheet = state.currentCheatsheet;
  if (!sheet) return;
  openEditor(index === null ? 'Add a note' : 'Edit note', 'Note text', index === null ? '' : sheet.items[index].text, null, '', text => {
    if (text.length > 100000) { alert('A note can contain at most 100,000 characters.'); return false; }
    if (index === null) sheet.items.push({ text, source: 'Manual', addedAt: new Date().toISOString() });
    else sheet.items[index].text = text;
    updateCheatsheetViewer();
  });
}
function renameCheatsheet() {
  const sheet = state.currentCheatsheet;
  if (!sheet) return;
  openEditor('Rename cheatsheet', 'Name', sheet.name, null, '', name => {
    if (name.length > 120 || state.cheatsheets.some(item => item !== sheet && item.name.toLowerCase() === name.toLowerCase())) { alert('Use a unique name of at most 120 characters.'); return false; }
    sheet.name = name; updateCheatsheetsDropdown(); updateCheatsheetViewer();
  });
}
function deleteCheatsheet() {
  const sheet = state.currentCheatsheet;
  if (!sheet || !confirm(`Delete "${sheet.name}" and its notes?`)) return;
  state.cheatsheets = state.cheatsheets.filter(item => item !== sheet);
  state.currentCheatsheet = null;
  updateCheatsheetsDropdown(); navigateHome(); renderProgress(); saveUserData();
}
function editFlashcard(edit = false) {
  const index = state.currentFlashcard;
  const card = edit ? state.generatedFlashcards[index] : null;
  if (edit && !card) return;
  openEditor(edit ? 'Edit flashcard' : 'Create flashcard', 'Question', card?.question || '', 'Answer', card?.answer || '', (question, answer) => {
    if (question.length > 10000 || answer.length > 100000) { alert('Question or answer is too long.'); return false; }
    if (edit) state.generatedFlashcards[index] = { question, answer };
    else { state.generatedFlashcards.push({ question, answer }); state.currentFlashcard = state.generatedFlashcards.length - 1; }
    state.isFlashcardFlipped = false; updateFlashcardsView();
  });
}
function deleteFlashcard() {
  if (!state.generatedFlashcards.length || !confirm('Delete this flashcard?')) return;
  state.generatedFlashcards.splice(state.currentFlashcard, 1);
  state.currentFlashcard = Math.max(0, Math.min(state.currentFlashcard, state.generatedFlashcards.length - 1));
  state.isFlashcardFlipped = false; updateFlashcardsView(); renderProgress(); saveUserData();
}

function downloadJSON(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function shareCheatsheet() {
  if (!state.currentCheatsheet) return;
  downloadJSON({ cheatsheets: [state.currentCheatsheet], chatMessages: [], generatedFlashcards: [], progress: {} }, 'smart-cram-shared-notes.json');
}
let importBusy = false;
async function mergeStudyData(imported) {
  if (importBusy || providerRequests) throw new Error('Wait for the current request to finish before importing.');
  importBusy = true;
  const app = document.getElementById('app-content');
  const wasInert = app.inert;
  app.inert = true;
  try { await mergeStudyDataNow(imported); }
  finally { importBusy = false; app.inert = wasInert; }
}
async function mergeStudyDataNow(imported) {
  if (!imported || !['cheatsheets', 'chatMessages', 'generatedFlashcards'].every(key => Array.isArray(imported[key]))) throw new Error('Choose a Smart Cram backup or shared-notes JSON file.');
  await saveQueue;
  if (unsavedData) throw new Error('Save your current edits before importing.');
  const candidate = structuredClone(studySnapshot());
  for (const sheet of imported.cheatsheets) {
    if (typeof sheet?.name !== 'string' || !sheet.name.trim()) throw new Error('Invalid cheatsheet name.');
    const base = sheet.name.trim().slice(0, 105); let name = base; let suffix = 2;
    while (candidate.cheatsheets.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${suffix++})`;
    candidate.cheatsheets.push({ ...sheet, name });
  }
  candidate.chatMessages.push(...imported.chatMessages);
  candidate.generatedFlashcards.push(...imported.generatedFlashcards);
  const result = await apiRequest('/api/data', { method: 'PUT', body: JSON.stringify({ ...candidate, revision: dataRevision }) });
  dataRevision = result.revision;
  await loadUserData(); navigateHome(); renderProgress();
}
async function importStudyFile(input) {
  const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a file smaller than 2 MB.');
    await mergeStudyData(JSON.parse(await file.text()));
    showSuccessNotification('Study data imported into your account.');
  } catch (error) { alert(`Import failed: ${error.message}`); }
  finally { input.value = ''; }
}

async function loadPDFJS() {
  if (!pdfLibraryLoad) pdfLibraryLoad = import('/vendor/pdf.mjs').then(lib => {
    window.pdfjsLib = lib;
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    return lib;
  }).catch(error => { pdfLibraryLoad = null; throw error; });
  return pdfLibraryLoad;
}
async function getTextbook() {
  const route = activeLibrarySection && currentLibraryBook()
    ? `/api/library/${encodeURIComponent(state.selectedSubject)}/${encodeURIComponent(activeLibrarySection)}` : '/api/textbook';
  const key = `${currentUser?.id || ''}:${route}`;
  if (textbookKey === key && textbookDocument) return textbookDocument;
  if (textbookKey === key && textbookLoad) return textbookLoad;
  textbookKey = key;
  const pending = (async () => {
    const response = await fetch(route, { headers: { 'X-Account-Id': String(currentUser.id) } });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
    const lib = await loadPDFJS();
    await textbookCleanup;
    const pdf = await lib.getDocument({ data: new Uint8Array(await response.arrayBuffer()), isEvalSupported: false }).promise;
    if (textbookKey !== key) { await pdf.loadingTask.destroy(); throw new Error('The selected section changed.'); }
    textbookDocument = pdf;
    updateTextbookNavigation();
    return pdf;
  })().catch(error => {
    if (textbookKey === key) { textbookLoad = null; updateTextbookNavigation(); }
    throw error;
  });
  textbookLoad = pending;
  return pending;
}
async function renderTextbookPage(pageNumber = textbookPage, highlight = '') {
  const version = ++renderVersion;
  const viewer = document.getElementById('pdf-viewer');
  textbookNavigationBusy = true; updateTextbookNavigation();
  viewer.textContent = 'Loading textbook…';
  try {
    const pdf = await getTextbook();
    if (version !== renderVersion) return;
    textbookPage = Math.max(1, Math.min(Number(pageNumber) || 1, pdf.numPages));
    const page = await pdf.getPage(textbookPage);
    const content = await page.getTextContent();
    if (version !== renderVersion) return;
    const canvas = document.createElement('canvas');
    const viewport = page.getViewport({ scale: Math.min(1.4, Math.max(0.5, (viewer.clientWidth || 650) / page.getViewport({ scale: 1 }).width)) });
    canvas.width = viewport.width; canvas.height = viewport.height;
    canvas.setAttribute('aria-label', `Textbook page ${textbookPage}`);
    const text = document.createElement('div'); text.className = 'textbook-text';
    const pageText = content.items.map(item => item.str).join(' ');
    text.textContent = pageText || 'This page has no selectable text. Scanned PDFs need OCR before text search.';
    if (highlight) {
      const start = pageText.toLowerCase().indexOf(highlight.toLowerCase());
      if (start >= 0) {
        text.textContent = '';
        text.append(document.createTextNode(pageText.slice(0, start)));
        const mark = document.createElement('mark'); mark.textContent = pageText.slice(start, start + highlight.length); text.append(mark, document.createTextNode(pageText.slice(start + highlight.length)));
      }
    }
    viewer.replaceChildren(canvas, text);
    document.getElementById('textbook-page').value = textbookPage;
    document.getElementById('textbook-page').max = pdf.numPages;
    document.getElementById('textbook-count').textContent = `of ${pdf.numPages}`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (version === renderVersion) { textbookNavigationBusy = false; updateTextbookNavigation(); }
  } catch (error) {
    if (version === renderVersion) {
      viewer.textContent = error.message;
      textbookNavigationBusy = false; updateTextbookNavigation();
    }
  }
}
async function uploadTextbook(input) {
  const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF smaller than 25 MB.');
    const lib = await loadPDFJS();
    const candidate = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    candidate.onPassword = () => candidate.destroy();
    try { await candidate.promise; }
    catch { throw new Error('Choose a valid, unlocked PDF. Your previous textbook has been kept.'); }
    finally { await candidate.destroy(); }
    await apiRequest('/api/textbook', { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
    ++renderVersion;
    if (textbookDocument) await textbookDocument.loadingTask.destroy();
    textbookDocument = null; textbookLoad = null; textbookPage = 1;
    activeLibrarySection = null; textbookKey = ''; renderLibraryNavigation();
    await refreshServices(); await renderTextbookPage(1);
  } catch (error) { alert(`Textbook upload failed: ${error.message}`); }
  finally { input.value = ''; }
}
async function searchTextbook(query) {
  const pdf = await getTextbook();
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])].filter(word => !['what', 'when', 'which', 'with', 'from', 'that', 'this', 'were', 'explain', 'describe'].includes(word));
  if (!words.length) throw new Error('Enter a more specific search phrase.');
  let best = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    const lower = text.toLowerCase();
    const matches = words.filter(word => lower.includes(word));
    const score = matches.length + (lower.includes(query.toLowerCase()) ? words.length : 0);
    if (score && (!best || score > best.score)) best = { page: i, text, score, word: matches[0] };
  }
  return best;
}
async function findInTextbook(query = document.getElementById('textbook-search').value.trim()) {
  if (!query) return;
  const searchVersion = ++textbookSearchVersion;
  const renderAtStart = renderVersion;
  const button = document.getElementById('textbook-find'); button.disabled = true;
  try {
    const match = await searchTextbook(query);
    if (searchVersion !== textbookSearchVersion || renderAtStart !== renderVersion) return;
    if (!match) { showSuccessNotification('No matching text found. Try different keywords or a searchable PDF.'); return; }
    await renderTextbookPage(match.page, match.word);
    if (searchVersion !== textbookSearchVersion) return;
    const start = Math.max(0, match.text.toLowerCase().indexOf(match.word) - 150);
    highlightTextInPDFViewer(match.text.slice(start, start + 1500), query, { name: currentTextbookSource(), pageStart: match.page, pageEnd: match.page });
  } catch (error) { if (searchVersion === textbookSearchVersion) showSuccessNotification(error.message); }
  finally { if (searchVersion === textbookSearchVersion) button.disabled = false; }
}
function clearTextbookSearch() {
  document.getElementById('textbook-search').value = '';
  const findButton = document.getElementById('textbook-find');
  const wasSearching = findButton.disabled;
  ++textbookSearchVersion;
  findButton.disabled = false;
  document.getElementById('highlight-overlay')?.remove();
  state.currentHighlightData = null;
  if (wasSearching || document.querySelector('#pdf-viewer mark')) renderTextbookPage(textbookPage);
}
async function highlightInPDF(id) {
  const question = state.loadedQuestions[state.selectedSubject]?.[state.selectedPaper]?.find(item => String(item.question_id) === String(id));
  if (question) await findInTextbook(question.text);
}
