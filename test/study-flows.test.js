import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { jsPDF } from 'jspdf';
import vm from 'node:vm';

async function browser(t) {
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost:3000' });
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve));
  t.after(() => dom.window.close());
  const { window } = dom;
  window.alert = text => { throw new Error(text); };
  window.confirm = () => true;
  window.structuredClone = structuredClone;
  window.fetch = async () => ({ ok: true, json: async () => ({ revision: 1 }) });
  const context = dom.getInternalVMContext();
  for (const file of ['account.js', 'script.js', 'study-tools.js']) vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  vm.runInContext('showSuccessNotification = () => {};', context);
  return { window, run: source => vm.runInContext(source, context), document: window.document };
}

test('selection survives the new-cheatsheet dialog and duplicate names are rejected', async t => {
  const { run, document, window } = await browser(t);
  run(`state.selectedText = 'Selected textbook passage'; createNewCheatsheetFromSelection();`);
  document.getElementById('cheatsheet-name').value = 'Revolution';
  run('createCheatsheet()');
  assert.equal(run('state.cheatsheets[0].items[0].text'), 'Selected textbook passage');
  assert.equal(run('state.currentCheatsheet.name'), 'Revolution');
  document.getElementById('cheatsheet-name').value = 'revolution';
  window.alert = () => {};
  run('createCheatsheet()');
  assert.equal(run('state.cheatsheets.length'), 1);
});

test('note editing, renaming, and deleting a cheatsheet update the visible state', async t => {
  const { run, document } = await browser(t);
  run(`state.cheatsheets = [{name:'Notes',items:[]}]; viewCheatsheet('Notes'); editNote();`);
  document.getElementById('editor-first').value = 'A manually entered note';
  run('submitEditor({preventDefault(){}})');
  assert.equal(run('state.currentCheatsheet.items[0].text'), 'A manually entered note');
  run('editNote(0)'); document.getElementById('editor-first').value = '<script>not executable</script>';
  run('submitEditor({preventDefault(){}})');
  assert.equal(document.querySelector('.cheatsheet-item-content').textContent, '<script>not executable</script>');
  assert.equal(document.querySelector('.cheatsheet-item-content script'), null);
  run('renameCheatsheet()'); document.getElementById('editor-first').value = 'New name';
  run('submitEditor({preventDefault(){}})');
  assert.match(document.getElementById('cheatsheet-viewer-title').textContent, /New name/);
  run('deleteCheatsheet()'); assert.equal(run('state.cheatsheets.length'), 0);
});

test('manual flashcards support creation, flipping, editing, navigation and deletion', async t => {
  const { run, document } = await browser(t);
  run('editFlashcard()');
  document.getElementById('editor-first').value = 'When did the French Revolution begin?';
  document.getElementById('editor-second').value = '1789';
  run('submitEditor({preventDefault(){}}); showFlashcards(); flipCard()');
  assert.equal(document.getElementById('answer-text').textContent, '1789');
  assert.ok(document.getElementById('flashcard').classList.contains('flipped'));
  run('editFlashcard(true)'); document.getElementById('editor-second').value = 'In 1789';
  run('submitEditor({preventDefault(){}}); nextCard(); previousCard()');
  assert.equal(document.getElementById('answer-text').textContent, 'In 1789');
  run('deleteFlashcard()'); assert.equal(run('state.generatedFlashcards.length'), 0);
  assert.ok(document.getElementById('flashcard-viewer').classList.contains('hidden'));
});

test('paper progress is included in saved snapshots and can be unmarked', async t => {
  const { run, document } = await browser(t);
  run(`state.selectedSubject='history';state.selectedPaper='2024-25';state.loadedQuestions={history:{'2024-25':[{question_id:'2',text:'Question',marks:1}]}};toggleQuestionStudied('2');`);
  assert.equal(run('studySnapshot().progress.completedQuestions[0]'), 'history/2024-25/2');
  assert.match(document.getElementById('study-progress').textContent, /1 questions studied/);
  run("toggleQuestionStudied('2')"); assert.equal(run('studySnapshot().progress.completedQuestions.length'), 0);
});

test('PDF export paginates a note longer than a page', async t => {
  const { run, window } = await browser(t);
  let exported;
  window.jspdf = { jsPDF: function(options) { const pdf = new jsPDF(options); pdf.save = () => { exported = pdf; }; return pdf; } };
  run(`state.currentCheatsheet={name:'Long notes',items:[{text:'A full line of study notes. '.repeat(1500),source:'Manual',addedAt:'2026-10-22'}]};`);
  await run('exportCheatsheetAsPDF()');
  assert.ok(exported.getNumberOfPages() > 3);
});

test('failed import leaves existing in-memory data unchanged', async t => {
  const { run, window } = await browser(t);
  run(`state.cheatsheets=[{name:'Original',items:[]}];`);
  window.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Invalid notes' }) });
  await assert.rejects(run(`mergeStudyData({cheatsheets:[{name:'Bad',items:null}],chatMessages:[],generatedFlashcards:[]})`), /Invalid notes/);
  assert.equal(run('state.cheatsheets.length'), 1);
  assert.equal(run('state.cheatsheets[0].name'), 'Original');
});

test('AI cards append to existing cards and switch away from the active view', async t => {
  const {run,window,document}=await browser(t);
  run(`state.generatedFlashcards=[{question:'Existing',answer:'Keep me'}];state.currentCheatsheet={name:'Notes',items:[{text:'1789'}]};state.currentView='hero';`);
  window.fetch=async()=>({ok:true,json:async()=>({flashcards:[{question:'New',answer:'1789'}]})});
  await run('confirmAIFlashcardGeneration()');
  assert.equal(run('state.generatedFlashcards.length'),2);
  assert.equal(run('state.generatedFlashcards[0].answer'),'Keep me');
  assert.equal(run('state.currentFlashcard'),1);
  assert.ok(document.getElementById('hero-section').classList.contains('hidden'));
  assert.equal(run('flashcardsBusy'),false);
});

test('textbook search selects the best matching page and returns original text',async t=>{
  const {run}=await browser(t);
  run(`textbookKey=':/api/textbook';textbookDocument={numPages:2,getPage:async n=>({getTextContent:async()=>({items:[{str:n===1?'The French Revolution began in 1789.':'Nationalism in Europe'}]})})};`);
  const result=await run(`searchTextbook('French Revolution')`);
  assert.equal(result.page,1);
  assert.equal(result.text,'The French Revolution began in 1789.');
  assert.equal(await run(`searchTextbook('industrialization')`),null);
});

test('PDF page navigation follows document boundaries and ignores unavailable moves',async t=>{
  const {run,document,window}=await browser(t);
  window.HTMLCanvasElement.prototype.getContext=()=>({});
  let renderedPages=[];
  const pdf={numPages:3,getPage:async number=>({
    getTextContent:async()=>({items:[{str:`Page ${number}`}]}),
    getViewport:({scale})=>({width:600*scale,height:800*scale}),
    render:()=>({promise:Promise.resolve().then(()=>renderedPages.push(number))})
  })};
  window.testPdf=pdf;
  run('textbookDocument = window.testPdf; getTextbook = async () => textbookDocument');
  await run('renderTextbookPage(1)');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,false);
  const initialRenderCount=renderedPages.length;
  await run('navigateTextbookPage(-1)');
  assert.equal(renderedPages.length,initialRenderCount);
  await run('navigateTextbookPage(1)');
  assert.equal(run('textbookPage'),2);
  assert.equal(document.getElementById('previous-page').disabled,false);
  assert.equal(document.getElementById('next-page').disabled,false);
  await run('navigateTextbookPage(1)');
  assert.equal(run('textbookPage'),3);
  assert.equal(document.getElementById('previous-page').disabled,false);
  assert.equal(document.getElementById('next-page').disabled,true);
  const lastPageRenderCount=renderedPages.length;
  await run('navigateTextbookPage(1)');
  assert.equal(renderedPages.length,lastPageRenderCount);

  pdf.numPages=1;
  await run('resetTextbook(); textbookDocument = window.testPdf; renderTextbookPage(1)');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,true);
});

test('PDF page navigation stays disabled while loading and after loading fails',async t=>{
  const {run,document,window}=await browser(t);
  window.HTMLCanvasElement.prototype.getContext=()=>({});
  let resolvePdf;
  run('getTextbook = async () => { textbookDocument = await window.pendingPdf; return textbookDocument; }');
  window.pendingPdf=new Promise(resolve=>{resolvePdf=resolve;});
  const loading=run('renderTextbookPage(1)');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,true);
  await run('navigateTextbookPage(1)');
  const pdf={numPages:2,getPage:async()=>({
    getTextContent:async()=>({items:[{str:'Page 1'}]}),
    getViewport:({scale})=>({width:600*scale,height:800*scale}),
    render:()=>({promise:Promise.resolve()})
  })};
  resolvePdf(pdf);
  await loading;
  assert.equal(document.getElementById('next-page').disabled,false);

  run('resetTextbook(); getTextbook = async () => { throw new Error("PDF unavailable"); }');
  await run('renderTextbookPage(1)');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,true);
});

test('clearing textbook search removes highlights and preserves the open page',async t=>{
  const {run,document}=await browser(t);
  document.getElementById('textbook-search').value='French Revolution';
  document.getElementById('pdf-viewer').innerHTML='<mark>French</mark>';
  document.body.insertAdjacentHTML('beforeend','<div id="highlight-overlay"></div>');
  run(`textbookPage=4;activeLibrarySection='jess302';state.currentHighlightData={answer:'old result'};renderTextbookPage=page=>{window.clearedPage=page;document.querySelector('#pdf-viewer mark')?.remove();};clearTextbookSearch()`);
  assert.equal(document.getElementById('textbook-search').value,'');
  assert.equal(document.querySelector('#highlight-overlay'),null);
  assert.equal(document.querySelector('#pdf-viewer mark'),null);
  assert.equal(run('state.currentHighlightData'),null);
  assert.equal(run('window.clearedPage'),4);
  assert.equal(run('activeLibrarySection'),'jess302');
});

test('clearing a textbook search with no results is harmless',async t=>{
  const {run,document}=await browser(t);
  document.getElementById('textbook-search').value='No matching phrase';
  run(`textbookPage=5;activeLibrarySection='jess303';searchTextbook=async()=>null;window.renderedPage=null;renderTextbookPage=page=>{window.renderedPage=page;};`);
  await run('findInTextbook()');
  run('clearTextbookSearch()');
  assert.equal(document.getElementById('textbook-search').value,'');
  assert.equal(document.querySelector('#highlight-overlay'),null);
  assert.equal(document.querySelector('#pdf-viewer mark'),null);
  assert.equal(run('window.renderedPage'),null);
  assert.equal(run('textbookPage'),5);
  assert.equal(run('activeLibrarySection'),'jess303');
});

test('clearing an in-flight textbook search prevents stale results from returning',async t=>{
  const {run,document,window}=await browser(t);
  let resolveSearch;
  const pendingSearch=new Promise(resolve=>{resolveSearch=resolve;});
  document.getElementById('textbook-search').value='French Revolution';
  run(`textbookPage=3;activeLibrarySection='jess301';searchTextbook=()=>window.pendingSearch;renderTextbookPage=page=>{window.clearedPage=page;};`);
  window.pendingSearch=pendingSearch;
  const find=run('findInTextbook()');
  assert.equal(document.getElementById('textbook-find').disabled,true);
  run('clearTextbookSearch()');
  resolveSearch({page:8,text:'French Revolution began in 1789.',word:'French'});
  await find;
  assert.equal(run('window.clearedPage'),3);
  assert.equal(document.querySelector('#highlight-overlay'),null);
  assert.equal(document.getElementById('textbook-find').disabled,false);
  assert.equal(run('textbookPage'),3);
  assert.equal(run('activeLibrarySection'),'jess301');
});

test('video iframe sends the origin referrer required for embedded playback', async t=>{
  const {document}=await browser(t);
  assert.equal(document.getElementById('video-player-iframe').getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
});

test('book cards and section navigation select the correct shared PDF and paper availability', async t => {
  const {run,window,document}=await browser(t);
  const books=JSON.parse(readFileSync(new URL('../library.json',import.meta.url),'utf8'));
  window.fetch=async()=>({ok:true,json:async()=>({books})});
  await run('loadLibrary()');
  assert.equal(document.querySelectorAll('.book-card').length,8);
  run('renderTextbookPage = () => {}; selectSubject("science")');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,true);
  assert.equal(run('activeLibrarySection'),'jesc101');
  assert.equal(document.getElementById('library-section').options.length,15);
  assert.equal(document.getElementById('papers-btn').disabled,true);
  run('stepLibrarySection(1)');
  assert.equal(run('activeLibrarySection'),'jesc102');
  assert.equal(document.getElementById('previous-page').disabled,true);
  assert.equal(document.getElementById('next-page').disabled,true);
  assert.match(document.getElementById('pdf-title').textContent,/Acids/);
  run('selectSubject("history")');
  assert.equal(document.getElementById('papers-btn').disabled,false);
  assert.equal(run('activeLibrarySection'),'jess301');
  run('selectLibrarySection("jess3ps")');
  assert.equal(document.getElementById('previous-section').disabled,true);
  run('selectLibrarySection("not-a-section")');
  assert.equal(run('activeLibrarySection'),'jess3ps');
  assert.match(run('currentTextbookSource()'),/Front matter/);
});

test('changing books disposes the PDF loading task and clears stale search results', async t => {
  const {run}=await browser(t);
  run(`window.disposed = false; textbookDocument = {loadingTask:{destroy: async()=>{window.disposed=true;}}}; state.currentHighlightData={answer:'old chapter'}; resetTextbook();`);
  await run('textbookCleanup');
  assert.equal(run('window.disposed'),true);
  assert.equal(run('textbookDocument'),null);
  assert.equal(run('state.currentHighlightData'),null);
});

test('landing registration link opens the correct form without changing default sign-in', async t => {
  const {run,window,document}=await browser(t);
  window.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Please sign in'})});
  await run('initializeAccount()');
  assert.equal(document.getElementById('auth-submit').textContent,'Sign in');
  window.history.replaceState(null,'','/app?mode=register');
  await run('initializeAccount()');
  assert.equal(document.getElementById('auth-submit').textContent,'Create account');
  assert.equal(document.getElementById('auth-name').required,true);
  assert.equal(document.getElementById('auth-panel').hidden,false);
});
