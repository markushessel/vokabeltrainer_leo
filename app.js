(() => {
  'use strict';

  const STORAGE_KEY = 'vokabeltrainer-state-v1';
  const APP_VERSION = '1.0.0';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

  const els = {
    learn: document.getElementById('view-learn'),
    words: document.getElementById('view-words'),
    import: document.getElementById('view-import'),
    settings: document.getElementById('view-settings'),
    offlineBadge: document.getElementById('offlineBadge'),
    dialog: document.getElementById('editDialog'),
    toast: document.getElementById('toast')
  };

  let state = loadState();
  let activeView = 'learn';
  let study = null;
  let importCandidates = [];
  let ocrWorker = null;
  let toastTimer = null;

  function defaultState() {
    return {
      version: 1,
      cards: [],
      progress: {},
      settings: {
        direction: 'de-en',
        shuffle: true,
        dueOnly: false,
        includeOptional: true,
        autoSpeak: true,
        voiceLang: 'en-GB'
      },
      ui: {
        chapter: 'all',
        sections: ['*']
      }
    };
  }

  function loadState() {
    try {
      const base = defaultState();
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.cards)) return base;
      return {
        ...base,
        ...parsed,
        settings: {...base.settings, ...(parsed.settings || {})},
        ui: {...base.ui, ...(parsed.ui || {})},
        progress: parsed.progress || {}
      };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function seedIfNeeded() {
    if (state.cards.length) return;
    const seed = Array.isArray(window.SEED_VOCAB) ? window.SEED_VOCAB : [];
    state.cards = seed.map(card => ({...card}));
    saveState();
  }

  function uid(prefix='card') {
    if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function esc(value='') {
    return String(value)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function formatDate(iso) {
    if (!iso) return '–';
    try { return new Intl.DateTimeFormat('de-DE', {day:'2-digit', month:'2-digit'}).format(new Date(iso)); }
    catch { return '–'; }
  }

  function chapterNames() {
    return [...new Set(state.cards.map(c => c.chapter || 'Ohne Kapitel'))].sort((a,b) => a.localeCompare(b,'de'));
  }

  function sectionNames(chapter='all') {
    const cards = chapter === 'all' ? state.cards : state.cards.filter(c => c.chapter === chapter);
    return [...new Set(cards.map(c => c.section || 'Ohne Abschnitt'))].sort((a,b) => a.localeCompare(b,'de'));
  }

  function progressFor(id) {
    return state.progress[id] || {seen:0, correct:0, streak:0, nextDue:null, lastResult:null};
  }

  function isDue(card) {
    const p = progressFor(card.id);
    return !p.nextDue || new Date(p.nextDue).getTime() <= Date.now();
  }

  function selectionCards() {
    let cards = [...state.cards];
    const chapter = state.ui.chapter || 'all';
    if (chapter !== 'all') cards = cards.filter(c => c.chapter === chapter);
    const sections = state.ui.sections || [];
    if (!sections.includes('*')) cards = cards.filter(c => sections.includes(c.section));
    if (!state.settings.includeOptional) cards = cards.filter(c => !c.isOptional);
    if (state.settings.dueOnly) cards = cards.filter(isDue);
    return cards;
  }

  function shuffled(list) {
    const a = [...list];
    for (let i=a.length-1;i>0;i--) {
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      toast('Sprachausgabe wird auf diesem Gerät nicht unterstützt.');
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.settings.voiceLang || 'en-GB';
    u.rate = 0.88;
    const voices = speechSynthesis.getVoices();
    const exact = voices.find(v => v.lang === u.lang);
    const english = voices.find(v => v.lang?.startsWith('en'));
    if (exact || english) u.voice = exact || english;
    speechSynthesis.speak(u);
  }

  function switchView(view) {
    activeView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    document.querySelectorAll('.tab').forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderCurrent();
    document.getElementById('main').focus({preventScroll:true});
  }

  function renderCurrent() {
    if (activeView === 'learn') renderLearn();
    if (activeView === 'words') renderWords();
    if (activeView === 'import') renderImport();
    if (activeView === 'settings') renderSettings();
  }

  function renderLearn() {
    if (study) return renderStudy();
    const chapters = chapterNames();
    if (!chapters.includes(state.ui.chapter)) state.ui.chapter = 'all';
    const sections = sectionNames(state.ui.chapter);
    let validSelections = (state.ui.sections || []).filter(s => s === '*' || sections.includes(s));
    if (!Array.isArray(state.ui.sections) || state.ui.sections.length === 0 && !localStorage.getItem(STORAGE_KEY)) validSelections = ['*'];
    if (validSelections.length !== (state.ui.sections || []).length) {
      state.ui.sections = validSelections;
      saveState();
    }
    const selected = selectionCards();
    const learned = state.cards.filter(c => progressFor(c.id).correct > 0).length;
    const due = state.cards.filter(isDue).length;
    const sectionCounts = new Map();
    (state.ui.chapter === 'all' ? state.cards : state.cards.filter(c => c.chapter === state.ui.chapter)).forEach(c => sectionCounts.set(c.section, (sectionCounts.get(c.section)||0)+1));

    els.learn.innerHTML = `
      <div class="panel">
        <h2>Was möchtest du lernen?</h2>
        <div class="grid-3">
          <div class="metric"><strong>${state.cards.length}</strong><small>Vokabeln</small></div>
          <div class="metric"><strong>${learned}</strong><small>schon gewusst</small></div>
          <div class="metric"><strong>${due}</strong><small>heute fällig</small></div>
        </div>
      </div>

      <div class="panel">
        <label class="field"><span>Kapitel</span>
          <select id="chapterSelect">
            <option value="all">Alle Kapitel</option>
            ${chapters.map(c => `<option value="${esc(c)}" ${state.ui.chapter===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </label>

        <div class="row between"><h3>Abschnitte</h3><button class="btn" id="toggleSections">${state.ui.sections.includes('*') ? 'Keine auswählen' : 'Alle auswählen'}</button></div>
        <div class="section-list">
          ${sections.map(s => `<div class="section-chip"><label><input type="checkbox" class="sectionCheck" value="${esc(s)}" ${(state.ui.sections.includes('*')||state.ui.sections.includes(s))?'checked':''}><span>${esc(s)}</span></label><span class="count">${sectionCounts.get(s)||0}</span></div>`).join('')}
        </div>

        <hr>
        <div class="segmented" role="group" aria-label="Abfragerichtung">
          <button data-direction="de-en" class="${state.settings.direction==='de-en'?'active':''}">Deutsch → Englisch</button>
          <button data-direction="en-de" class="${state.settings.direction==='en-de'?'active':''}">Englisch → Deutsch</button>
        </div>
        <label class="checkbox-row"><input id="shuffleCheck" type="checkbox" ${state.settings.shuffle?'checked':''}><span>Reihenfolge mischen</span></label>
        <label class="checkbox-row"><input id="dueOnlyCheck" type="checkbox" ${state.settings.dueOnly?'checked':''}><span>Nur fällige Karten abfragen</span></label>
        <label class="checkbox-row"><input id="optionalCheck" type="checkbox" ${state.settings.includeOptional?'checked':''}><span>Optionale / blaue Wörter mitlernen</span></label>

        <button id="startStudy" class="btn primary block" ${selected.length?'':'disabled'}>${selected.length ? `${selected.length} Karte${selected.length===1?'':'n'} starten` : 'Keine passenden Karten'}</button>
      </div>

      <div class="panel">
        <h3>So funktioniert es</h3>
        <p class="subtle">Karte ansehen, Lösung aufdecken und anschließend „Gewusst“ oder „Nochmal“ wählen. Englische Wörter können direkt vorgelesen werden. Der Lernstand bleibt lokal auf diesem iPhone gespeichert.</p>
      </div>
    `;

    document.getElementById('chapterSelect').onchange = e => {
      state.ui.chapter = e.target.value;
      state.ui.sections = ['*'];
      saveState(); renderLearn();
    };
    document.getElementById('toggleSections').onclick = () => {
      state.ui.sections = state.ui.sections.includes('*') ? [] : ['*'];
      saveState(); renderLearn();
    };
    document.querySelectorAll('.sectionCheck').forEach(cb => cb.onchange = () => {
      const checked = [...document.querySelectorAll('.sectionCheck:checked')].map(x => x.value);
      state.ui.sections = checked.length === sections.length ? ['*'] : checked;
      saveState(); renderLearn();
    });
    document.querySelectorAll('[data-direction]').forEach(btn => btn.onclick = () => {
      state.settings.direction = btn.dataset.direction;
      saveState(); renderLearn();
    });
    document.getElementById('shuffleCheck').onchange = e => { state.settings.shuffle=e.target.checked; saveState(); };
    document.getElementById('dueOnlyCheck').onchange = e => { state.settings.dueOnly=e.target.checked; saveState(); renderLearn(); };
    document.getElementById('optionalCheck').onchange = e => { state.settings.includeOptional=e.target.checked; saveState(); renderLearn(); };
    document.getElementById('startStudy').onclick = startStudy;
  }

  function startStudy() {
    let cards = selectionCards();
    if (state.settings.shuffle) cards = shuffled(cards);
    study = {cards, index:0, revealed:false, correct:0, again:0};
    renderStudy();
  }

  function renderStudy() {
    if (!study) return renderLearn();
    if (study.index >= study.cards.length) return renderStudySummary();
    const card = study.cards[study.index];
    const direction = state.settings.direction;
    const front = direction === 'de-en' ? card.german : card.english;
    const answer = direction === 'de-en' ? card.english : card.german;
    const frontLabel = direction === 'de-en' ? 'Deutsch' : 'Englisch';
    const answerLabel = direction === 'de-en' ? 'Englisch' : 'Deutsch';
    const pct = Math.round((study.index / Math.max(1, study.cards.length))*100);

    els.learn.innerHTML = `
      <div class="study-shell">
        <div class="study-top"><button id="closeStudy" class="btn">← Beenden</button><strong>${study.index+1} / ${study.cards.length}</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <button id="flashcard" class="flashcard" aria-label="Karte umdrehen">
          <span class="side-label">${frontLabel}</span>
          <div>
            <div class="term">${esc(front)}</div>
            ${study.revealed ? `<div class="answer"><small style="display:block;font-size:11px;letter-spacing:.08em;color:#687087;text-transform:uppercase;margin-bottom:8px">${answerLabel}</small>${esc(answer)}</div>` : '<div class="reveal-hint">Antippen, um die Lösung zu sehen</div>'}
          </div>
          <div class="source">${esc(card.chapter)} · ${esc(card.section)}${card.isOptional?' · optional':''}</div>
        </button>
        ${study.revealed ? `
          <div class="row" style="margin-top:12px"><button id="speakBtn" class="btn block">🔊 Englisch vorlesen</button></div>
          <div class="study-actions three"><button id="skipBtn" class="btn">Überspringen</button><button id="againBtn" class="btn danger">↻ Nochmal</button><button id="knownBtn" class="btn success">✓ Gewusst</button></div>
        ` : `<div class="study-actions"><button id="revealBtn" class="btn primary block" style="grid-column:1/-1">Lösung zeigen</button></div>`}
      </div>
    `;

    document.getElementById('closeStudy').onclick = () => { study=null; renderLearn(); };
    const reveal = () => {
      if (study.revealed) return;
      study.revealed = true;
      renderStudy();
      if (state.settings.autoSpeak && direction === 'de-en') setTimeout(() => speak(card.english), 100);
    };
    document.getElementById('flashcard').onclick = reveal;
    const rb = document.getElementById('revealBtn'); if (rb) rb.onclick = reveal;
    const sb = document.getElementById('speakBtn'); if (sb) sb.onclick = e => { e.stopPropagation(); speak(card.english); };
    const again = document.getElementById('againBtn'); if (again) again.onclick = () => markCard(card,false);
    const known = document.getElementById('knownBtn'); if (known) known.onclick = () => markCard(card,true);
    const skip = document.getElementById('skipBtn'); if (skip) skip.onclick = () => { study.index++; study.revealed=false; renderStudy(); };
  }

  function markCard(card, correct) {
    const old = progressFor(card.id);
    const p = {...old};
    p.seen = (p.seen||0)+1;
    p.lastResult = correct ? 'correct' : 'again';
    if (correct) {
      p.correct = (p.correct||0)+1;
      p.streak = (p.streak||0)+1;
      const days = [1,3,7,14,30,60][Math.min(p.streak-1,5)];
      p.nextDue = new Date(Date.now()+days*86400000).toISOString();
      study.correct++;
    } else {
      p.streak = 0;
      p.nextDue = new Date(Date.now()+10*60*1000).toISOString();
      study.again++;
      // Repeat once near the end of the current session.
      if (!study.cards.slice(study.index+1).some(c => c.id === card.id)) study.cards.push(card);
    }
    state.progress[card.id]=p;
    saveState();
    study.index++;
    study.revealed=false;
    renderStudy();
  }

  function renderStudySummary() {
    els.learn.innerHTML = `
      <div class="panel" style="text-align:center;padding:28px 18px">
        <div style="font-size:52px">🎉</div>
        <h2>Runde geschafft</h2>
        <p class="subtle">Dein Lernstand wurde auf diesem iPhone gespeichert.</p>
        <div class="grid-2" style="margin:18px 0">
          <div class="metric"><strong>${study.correct}</strong><small>Gewusst</small></div>
          <div class="metric"><strong>${study.again}</strong><small>Nochmal</small></div>
        </div>
        <button id="finishStudy" class="btn primary block">Zur Übersicht</button>
      </div>
    `;
    document.getElementById('finishStudy').onclick = () => { study=null; renderLearn(); };
  }

  function renderWords() {
    const query = els.words.dataset.query || '';
    const chapter = els.words.dataset.chapter || 'all';
    let cards = state.cards.filter(c => chapter==='all' || c.chapter===chapter);
    if (query) {
      const q=query.toLocaleLowerCase('de');
      cards=cards.filter(c => `${c.english} ${c.german} ${c.section}`.toLocaleLowerCase('de').includes(q));
    }
    cards.sort((a,b) => (a.chapter+a.section+a.english).localeCompare(b.chapter+b.section+b.english,'de'));
    els.words.innerHTML = `
      <div class="panel">
        <div class="row between"><div><h2>Vokabeln</h2><div class="subtle">${cards.length} von ${state.cards.length}</div></div><button id="addWord" class="btn primary">＋ Neu</button></div>
        <label class="field"><span>Suchen</span><input id="wordSearch" type="search" value="${esc(query)}" placeholder="Englisch oder Deutsch"></label>
        <label class="field"><span>Kapitel</span><select id="wordChapter"><option value="all">Alle Kapitel</option>${chapterNames().map(c=>`<option value="${esc(c)}" ${chapter===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      <div class="word-list">
        ${cards.length ? cards.map(c => {
          const p=progressFor(c.id);
          return `<div class="word-row"><div class="en">${esc(c.english)}</div><div class="de">${esc(c.german)}</div><div class="meta">${esc(c.chapter)} · ${esc(c.section)}${c.isOptional?' · optional':''}${p.correct?` · ${p.correct}× gewusst · fällig ${formatDate(p.nextDue)}`:''}</div><div class="actions"><button class="btn speakWord" data-id="${c.id}">🔊</button><button class="btn editWord" data-id="${c.id}">Bearbeiten</button></div></div>`;
        }).join('') : '<div class="panel empty">Keine Vokabeln gefunden.</div>'}
      </div>
    `;
    document.getElementById('wordSearch').oninput = e => { els.words.dataset.query=e.target.value; renderWords(); };
    document.getElementById('wordChapter').onchange = e => { els.words.dataset.chapter=e.target.value; renderWords(); };
    document.getElementById('addWord').onclick = () => openEditDialog();
    document.querySelectorAll('.speakWord').forEach(b=>b.onclick=()=>speak(state.cards.find(c=>c.id===b.dataset.id)?.english||''));
    document.querySelectorAll('.editWord').forEach(b=>b.onclick=()=>openEditDialog(state.cards.find(c=>c.id===b.dataset.id)));
  }

  function openEditDialog(card=null) {
    const editing=!!card;
    const chapters=chapterNames();
    els.dialog.innerHTML = `<form method="dialog" class="dialog-inner" id="wordForm">
      <div class="row between"><h2 style="margin:0">${editing?'Vokabel bearbeiten':'Vokabel hinzufügen'}</h2><button class="btn" value="cancel">✕</button></div>
      <label class="field"><span>Englisch</span><input id="editEnglish" type="text" required value="${esc(card?.english||'')}"></label>
      <label class="field"><span>Deutsch</span><input id="editGerman" type="text" required value="${esc(card?.german||'')}"></label>
      <label class="field"><span>Kapitel</span><input id="editChapter" list="chapterList" type="text" required value="${esc(card?.chapter || (state.ui.chapter==='all' ? '' : state.ui.chapter))}"><datalist id="chapterList">${chapters.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Abschnitt</span><input id="editSection" type="text" required value="${esc(card?.section||'')}"></label>
      <label class="checkbox-row"><input id="editOptional" type="checkbox" ${card?.isOptional?'checked':''}><span>Optional / muss nicht gelernt werden</span></label>
      <div class="row" style="margin-top:14px">${editing?'<button id="deleteWord" type="button" class="btn danger">Löschen</button>':''}<span style="flex:1"></span><button class="btn" value="cancel">Abbrechen</button><button id="saveWord" type="button" class="btn primary">Speichern</button></div>
    </form>`;
    els.dialog.showModal();
    document.getElementById('saveWord').onclick = () => {
      const english=document.getElementById('editEnglish').value.trim();
      const german=document.getElementById('editGerman').value.trim();
      const chapter=document.getElementById('editChapter').value.trim();
      const section=document.getElementById('editSection').value.trim();
      if (!english||!german||!chapter||!section) return toast('Bitte alle Pflichtfelder ausfüllen.');
      if (editing) Object.assign(card,{english,german,chapter,section,isOptional:document.getElementById('editOptional').checked});
      else state.cards.push({id:uid(),english,german,chapter,section,source:'Manuell',isOptional:document.getElementById('editOptional').checked,createdAt:new Date().toISOString()});
      saveState(); els.dialog.close(); renderWords(); toast('Gespeichert.');
    };
    const del=document.getElementById('deleteWord'); if (del) del.onclick=()=>{
      if (!confirm('Diese Vokabel wirklich löschen?')) return;
      state.cards=state.cards.filter(c=>c.id!==card.id); delete state.progress[card.id]; saveState(); els.dialog.close(); renderWords();
    };
  }

  function renderImport() {
    els.import.innerHTML = `
      <div class="panel">
        <h2>Neue Vokabeln hinzufügen</h2>
        <p class="subtle">PDF-, Foto-, Text- oder Sicherungsdatei auswählen. Die eigentliche Vokabelliste und der Lernstand werden danach lokal auf dem iPhone gespeichert.</p>
        <div class="dropzone">
          <input id="fileImport" type="file" accept=".pdf,.txt,.csv,.json,image/*" multiple>
          <p class="subtle">Für Fotos und gescannte PDFs wird eine lokale OCR-Erkennung verwendet. Beim allerersten OCR-Einsatz muss das Erkennungspaket aus dem Internet geladen werden.</p>
        </div>
        <div id="importStatus" class="import-status"></div>
      </div>

      <div class="panel">
        <h3>Oder Text einfügen</h3>
        <p class="subtle">Am zuverlässigsten ist eine Zeile pro Vokabel, getrennt durch <code>=</code>, Tabulator oder <code>;</code>, z. B. <code>to borrow = ausleihen</code>. Überschriften wie „Unit 2“, „Station 1“ oder „Reading corner“ werden als Kategorie übernommen.</p>
        <textarea id="pasteText" placeholder="Unit 2 Friends\nStation 1\nto borrow = ausleihen\nto understand = verstehen"></textarea>
        <div class="row"><button id="parseText" class="btn primary block">Text auswerten</button></div>
      </div>

      ${importCandidates.length ? renderCandidateEditor() : ''}
    `;

    document.getElementById('fileImport').onchange = handleFiles;
    document.getElementById('parseText').onclick = () => {
      const text=document.getElementById('pasteText').value;
      importCandidates=parseVocabularyText(text);
      renderImport();
      if (!importCandidates.length) toast('Keine eindeutigen Vokabelpaare erkannt.');
    };
    bindCandidateEditor();
  }

  function renderCandidateEditor() {
    return `<div class="panel"><div class="row between"><div><h3>Erkannte Vokabeln prüfen</h3><div class="subtle">Vor dem Übernehmen kannst du jede Zeile korrigieren.</div></div><span class="tag">${importCandidates.length}</span></div>
      <div class="candidate-table">${importCandidates.map((c,i)=>`<div class="candidate" data-i="${i}"><div class="mini-grid"><input class="cand-en" value="${esc(c.english)}" placeholder="Englisch"><input class="cand-de" value="${esc(c.german)}" placeholder="Deutsch"></div><div class="mini-grid" style="margin-top:8px"><input class="cand-ch" value="${esc(c.chapter)}" placeholder="Kapitel"><input class="cand-se" value="${esc(c.section)}" placeholder="Abschnitt"></div><div class="row between" style="margin-top:8px"><label class="checkbox-row"><input class="cand-opt" type="checkbox" ${c.isOptional?'checked':''}><span>optional</span></label><button class="btn danger cand-remove" type="button">Entfernen</button></div></div>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button id="clearCandidates" class="btn">Verwerfen</button><button id="commitCandidates" class="btn primary" style="flex:1">${importCandidates.length} Vokabeln übernehmen</button></div>
    </div>`;
  }

  function bindCandidateEditor() {
    document.querySelectorAll('.candidate').forEach(row => {
      const i=Number(row.dataset.i);
      row.querySelector('.cand-en').oninput=e=>importCandidates[i].english=e.target.value;
      row.querySelector('.cand-de').oninput=e=>importCandidates[i].german=e.target.value;
      row.querySelector('.cand-ch').oninput=e=>importCandidates[i].chapter=e.target.value;
      row.querySelector('.cand-se').oninput=e=>importCandidates[i].section=e.target.value;
      row.querySelector('.cand-opt').onchange=e=>importCandidates[i].isOptional=e.target.checked;
      row.querySelector('.cand-remove').onclick=()=>{importCandidates.splice(i,1);renderImport();};
    });
    const clear=document.getElementById('clearCandidates'); if(clear) clear.onclick=()=>{importCandidates=[];renderImport();};
    const commit=document.getElementById('commitCandidates'); if(commit) commit.onclick=commitImport;
  }

  function commitImport() {
    let added=0, skipped=0;
    const existing=new Set(state.cards.map(c=>`${c.english.trim().toLowerCase()}|${c.german.trim().toLowerCase()}|${c.chapter}|${c.section}`));
    for (const c of importCandidates) {
      const english=(c.english||'').trim(), german=(c.german||'').trim(), chapter=(c.chapter||'Import').trim(), section=(c.section||'Vokabeln').trim();
      if (!english||!german) { skipped++; continue; }
      const key=`${english.toLowerCase()}|${german.toLowerCase()}|${chapter}|${section}`;
      if (existing.has(key)) { skipped++; continue; }
      state.cards.push({id:uid(),english,german,chapter,section,source:c.source||'Import',isOptional:!!c.isOptional,createdAt:new Date().toISOString()});
      existing.add(key); added++;
    }
    saveState(); importCandidates=[]; renderImport(); toast(`${added} Vokabeln übernommen${skipped?`, ${skipped} übersprungen`:''}.`);
  }

  async function handleFiles(e) {
    const files=[...e.target.files];
    if (!files.length) return;
    const status=document.getElementById('importStatus');
    const all=[];
    for (let idx=0; idx<files.length; idx++) {
      const file=files[idx];
      status.textContent=`Verarbeite ${file.name} (${idx+1}/${files.length}) …`;
      try {
        if (file.name.toLowerCase().endsWith('.json')) {
          const json=JSON.parse(await file.text());
          if (json?.cards && Array.isArray(json.cards)) {
            all.push(...json.cards.map(c=>({...c, source:`Import: ${file.name}`})));
          } else if (Array.isArray(json)) all.push(...json);
          else throw new Error('JSON enthält keine Vokabelliste.');
        } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const text=await extractPdfText(file, msg => status.textContent=msg);
          all.push(...parseVocabularyText(text, file.name));
        } else if (file.type.startsWith('image/')) {
          const text=await ocrImage(file, msg => status.textContent=msg);
          all.push(...parseVocabularyText(text, file.name));
        } else {
          all.push(...parseVocabularyText(await file.text(), file.name));
        }
      } catch (err) {
        console.error(err);
        status.textContent=`${file.name}: ${err.message}`;
        toast(`Importfehler bei ${file.name}`);
      }
    }
    importCandidates=all;
    renderImport();
    if (all.length) toast(`${all.length} mögliche Vokabeln erkannt. Bitte prüfen.`);
  }

  async function loadScript(url, globalName) {
    if (globalName && window[globalName]) return;
    await new Promise((resolve,reject)=>{
      const old=[...document.scripts].find(s=>s.src===url);
      if (old) { old.addEventListener('load',resolve,{once:true}); old.addEventListener('error',reject,{once:true}); return; }
      const s=document.createElement('script'); s.src=url; s.async=true; s.onload=resolve; s.onerror=()=>reject(new Error('Zusatzmodul konnte nicht geladen werden. Bitte kurz online gehen.')); document.head.appendChild(s);
    });
  }

  async function extractPdfText(file, log=()=>{}) {
    log('PDF-Modul wird vorbereitet …');
    await loadScript(PDFJS_URL,'pdfjsLib');
    pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
    const data=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data}).promise;
    let text='';
    for (let p=1;p<=pdf.numPages;p++) {
      log(`PDF-Seite ${p} von ${pdf.numPages} wird gelesen …`);
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const items=content.items.map(i=>({str:i.str,x:i.transform[4],y:i.transform[5]}));
      // Reconstruct lines by y-position. Tabs preserve coarse column separation.
      const groups=[];
      items.sort((a,b)=>Math.abs(b.y-a.y)>2 ? b.y-a.y : a.x-b.x);
      for (const item of items) {
        let g=groups.find(g=>Math.abs(g.y-item.y)<2.2);
        if (!g) { g={y:item.y,items:[]}; groups.push(g); }
        g.items.push(item);
      }
      groups.sort((a,b)=>b.y-a.y);
      let pageText='';
      for (const g of groups) {
        g.items.sort((a,b)=>a.x-b.x);
        let line=''; let lastX=null;
        for (const it of g.items) {
          if (lastX!==null && it.x-lastX>45) line+='\t';
          else if (line && !line.endsWith('\t')) line+=' ';
          line+=it.str;
          lastX=it.x + Math.max(10,it.str.length*4);
        }
        pageText+=line.trim()+'\n';
      }
      if (pageText.replace(/\s/g,'').length < 30) {
        log(`PDF-Seite ${p}: kein Text eingebettet – starte Bilderkennung …`);
        const baseViewport=page.getViewport({scale:1});
        const scale=Math.min(2, 1800/Math.max(1,baseViewport.width));
        const viewport=page.getViewport({scale:Math.max(1.4,scale)});
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
        if (blob) pageText=await ocrImage(blob, msg=>log(`Seite ${p}: ${msg}`));
      }
      text+=pageText+'\n';
    }
    if (text.replace(/\s/g,'').length < 20) throw new Error('Aus der PDF konnte kein lesbarer Text gewonnen werden.');
    return text;
  }

  async function ocrImage(file, log=()=>{}) {
    log('OCR-Erkennung wird geladen …');
    await loadScript(TESSERACT_URL,'Tesseract');
    if (!ocrWorker) {
      ocrWorker=await Tesseract.createWorker(['eng','deu'],1,{logger:m=>{
        const pct=m.progress ? ` ${Math.round(m.progress*100)} %` : '';
        log(`${translateOcrStatus(m.status)}${pct}`);
      }});
    }
    log('Text im Bild wird erkannt …');
    const result=await ocrWorker.recognize(file);
    return result.data.text || '';
  }

  function translateOcrStatus(s='') {
    const map={
      'loading tesseract core':'OCR-Kern wird geladen',
      'initializing tesseract':'OCR wird initialisiert',
      'loading language traineddata':'Sprachdaten werden geladen',
      'initializing api':'Spracherkennung wird vorbereitet',
      'recognizing text':'Text wird erkannt'
    };
    return map[s] || s || 'OCR läuft';
  }

  function parseVocabularyText(raw, source='Textimport') {
    const text=String(raw||'').replace(/\r/g,'');
    const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
    let chapter='Import';
    let section='Vokabeln';
    const out=[];
    const headingPatterns=[
      {re:/^unit\s*\d+.*$/i,type:'chapter'},
      {re:/^(station\s*\d+.*|way in|reading corner|film corner|viewing skills|checkpoint|holiday activities|feelings|last summer)$/i,type:'section'}
    ];

    for (let rawLine of lines) {
      let line=rawLine.replace(/\s+/g,' ').trim();
      if (!line) continue;
      const chapterMatch=line.match(/^(Unit\s*\d+[^\t;=]*)$/i);
      if (chapterMatch) { chapter=cleanHeading(chapterMatch[1]); continue; }
      const sectionMatch=line.match(/^(Station\s*\d+[^\t;=]*|Way in|Reading corner|Film corner|Viewing skills|Checkpoint|Holiday activities|Feelings|Last summer)$/i);
      if (sectionMatch) {
        const h=cleanHeading(sectionMatch[1]);
        if (/^(Holiday activities|Feelings|Last summer)$/i.test(h) && /^Station/i.test(section)) section=`${section.split(' · ')[0]} · ${h}`;
        else section=h;
        continue;
      }
      if (/^(Vocabulary|Symbole|Abkürzungen|one hundred|p\.\s*\d+|page\s*\d+)/i.test(line)) continue;

      // Remove page numbers and phonetic transcriptions.
      line=line.replace(/^p\.\s*\d+\s*/i,'').replace(/\[[^\]]*\]/g,'').replace(/\([^)]*sg\)|\([^)]*pl\)/gi,'').trim();
      if (!line) continue;

      let parts=[];
      if (rawLine.includes('\t')) parts=rawLine.split(/\t+/).map(cleanCell).filter(Boolean);
      if (parts.length<2 && line.includes('=')) parts=line.split(/\s*=\s*/).map(cleanCell).filter(Boolean);
      if (parts.length<2 && line.includes(';')) {
        const semi=line.split(/\s*;\s*/).map(cleanCell).filter(Boolean);
        // Semicolons are often inside translations, so only treat exactly two chunks as a separator.
        if (semi.length===2) parts=semi;
      }
      if (parts.length<2 && /\s{2,}/.test(rawLine)) parts=rawLine.split(/\s{2,}/).map(cleanCell).filter(Boolean);

      if (parts.length>=2) {
        const english=cleanEnglish(parts[0]);
        const german=cleanGerman(parts[1]);
        if (looksLikePair(english,german)) out.push({english,german,chapter,section,source,isOptional:false});
        continue;
      }

      // Conservative fallback: split at common German vocabulary beginnings.
      const fallback=line.match(/^(.{2,55}?)\s+(der|die|das|den|dem|ein|eine|einen|einem|einer|sich|im|am|in|auf|aus|zwischen|vor|nach|wieder|heute|morgen|gestern|höflich|gut|klein|wahr|froh|ängstlich|überrascht|besorgt|beunruhigt|wütend|aufgeregt|unglücklich|entspannt|verwirrt|nervös|eifersüchtig|Tante|Hut|Sommer|Eltern|Stadt|Hochzeit|Ball|Großvater|Konzert|Telefon|Versuch|Szene|Rolltreppe|Warteschlange|Thunfisch|Abendessen|Gesellschaft|Firma)\b(.*)$/i);
      if (fallback) {
        const english=cleanEnglish(fallback[1]);
        const german=cleanGerman(`${fallback[2]}${fallback[3]}`);
        if (looksLikePair(english,german)) out.push({english,german,chapter,section,source,isOptional:false});
      }
    }
    return dedupeCandidates(out);
  }

  function cleanCell(s='') { return String(s).replace(/\[[^\]]*\]/g,'').replace(/^p\.\s*\d+\s*/i,'').replace(/\s+/g,' ').trim(); }
  function cleanEnglish(s='') { return cleanCell(s).replace(/^[•·\-–—]+\s*/,'').replace(/\s+\([^)]*\)$/,'').trim(); }
  function cleanGerman(s='') { return cleanCell(s).replace(/\s+(How|Did|We|I|You|They|He|She|It|What|When|Where|Why|Your|Our|My|Laura|Olivia|Luke|Gwen|Ben)\b.*$/,'').trim(); }
  function cleanHeading(s='') { return s.replace(/\s+/g,' ').trim(); }
  function looksLikePair(en,de) {
    if (!en||!de||en.length>90||de.length>120) return false;
    if (/^(How are|Did you|We can|I was|You can|They|He |She |It |What |When |Where |Why |Your |Our |My )/i.test(en) && en.endsWith('?')) return false;
    const enLetters=(en.match(/[A-Za-z]/g)||[]).length;
    const deLetters=(de.match(/[A-Za-zÄÖÜäöüß]/g)||[]).length;
    return enLetters>=2 && deLetters>=2;
  }
  function dedupeCandidates(list) {
    const seen=new Set();
    return list.filter(c=>{
      const k=`${c.english.toLowerCase()}|${c.german.toLowerCase()}|${c.chapter}|${c.section}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }

  function renderSettings() {
    const learned=Object.values(state.progress).filter(p=>p.correct>0).length;
    els.settings.innerHTML = `
      <div class="panel">
        <h2>Einstellungen</h2>
        <label class="field"><span>Englische Aussprache</span><select id="voiceLang"><option value="en-GB" ${state.settings.voiceLang==='en-GB'?'selected':''}>Britisches Englisch</option><option value="en-US" ${state.settings.voiceLang==='en-US'?'selected':''}>Amerikanisches Englisch</option></select></label>
        <label class="checkbox-row"><input id="autoSpeak" type="checkbox" ${state.settings.autoSpeak?'checked':''}><span>Nach dem Aufdecken automatisch Englisch vorlesen</span></label>
        <button id="testVoice" class="btn block">🔊 Aussprache testen</button>
      </div>

      <div class="panel">
        <h3>Offline</h3>
        <div class="notice">Lernen, Aussprache, Vokabelliste und Lernstand funktionieren nach dem ersten vollständigen Laden offline. Die Aussprache nutzt die iPhone-Stimmen.</div>
        <p class="subtle">Für die automatische Erkennung von Fotos/PDFs werden zusätzliche Bibliotheken benötigt. Du kannst sie einmalig vorbereiten, solange das iPhone online ist.</p>
        <button id="prepareOffline" class="btn primary block">OCR/PDF für Offline-Nutzung vorbereiten</button>
        <div id="offlinePrepStatus" class="import-status"></div>
      </div>

      <div class="panel">
        <h3>Sicherung</h3>
        <p class="subtle">Enthält alle Vokabeln und den Lernstand. Die Datei kann per AirDrop gesichert oder auf ein anderes Gerät übertragen werden.</p>
        <div class="grid-2"><button id="exportBackup" class="btn">Sicherung exportieren</button><label class="btn" style="display:grid;place-items:center;cursor:pointer">Sicherung importieren<input id="backupImport" type="file" accept=".json" hidden></label></div>
      </div>

      <div class="panel">
        <h3>Lernstand</h3>
        <p class="subtle">${learned} Vokabeln wurden mindestens einmal als „Gewusst“ markiert.</p>
        <button id="resetProgress" class="btn danger block">Nur Lernstand zurücksetzen</button>
      </div>

      <div class="panel"><div class="subtle">Vokabeltrainer ${APP_VERSION} · ${state.cards.length} Vokabeln · Daten werden lokal gespeichert.</div></div>
    `;
    document.getElementById('voiceLang').onchange=e=>{state.settings.voiceLang=e.target.value;saveState();};
    document.getElementById('autoSpeak').onchange=e=>{state.settings.autoSpeak=e.target.checked;saveState();};
    document.getElementById('testVoice').onclick=()=>speak('Hello! Let us learn English together.');
    document.getElementById('prepareOffline').onclick=prepareOfflineEngines;
    document.getElementById('exportBackup').onclick=exportBackup;
    document.getElementById('backupImport').onchange=importBackup;
    document.getElementById('resetProgress').onclick=()=>{
      if (!confirm('Den gesamten Lernstand zurücksetzen? Die Vokabeln bleiben erhalten.')) return;
      state.progress={};saveState();renderSettings();toast('Lernstand zurückgesetzt.');
    };
  }

  async function prepareOfflineEngines() {
    const status=document.getElementById('offlinePrepStatus');
    if (!navigator.onLine) { status.textContent='Bitte für diese einmalige Vorbereitung kurz mit dem Internet verbinden.'; return; }
    try {
      status.textContent='PDF-Modul wird geladen …';
      await loadScript(PDFJS_URL,'pdfjsLib');
      pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
      // Ask the active service worker to cache the main external files as well.
      navigator.serviceWorker?.controller?.postMessage({type:'CACHE_URLS',urls:[PDFJS_URL,PDFJS_WORKER_URL,TESSERACT_URL]});
      status.textContent='OCR-Modul wird geladen …';
      await loadScript(TESSERACT_URL,'Tesseract');
      if (!ocrWorker) {
        ocrWorker=await Tesseract.createWorker(['eng','deu'],1,{logger:m=>{
          const pct=m.progress?` ${Math.round(m.progress*100)} %`:'';
          status.textContent=`${translateOcrStatus(m.status)}${pct}`;
        }});
      }
      status.textContent='Fertig. OCR-Sprachdaten wurden lokal vorbereitet. Du kannst die App jetzt auch ohne Internet zum Lernen nutzen; die Erkennung sollte nach erfolgreicher Vorbereitung ebenfalls offline verfügbar sein.';
      toast('Offline-Paket vorbereitet.');
    } catch(err) {
      console.error(err);
      status.textContent=`Vorbereitung nicht vollständig: ${err.message}. Das Lernen funktioniert trotzdem offline.`;
    }
  }

  function exportBackup() {
    const payload={app:'Vokabeltrainer',version:1,exportedAt:new Date().toISOString(),cards:state.cards,progress:state.progress,settings:state.settings};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`vokabeltrainer-sicherung-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function importBackup(e) {
    const file=e.target.files?.[0]; if(!file) return;
    try {
      const data=JSON.parse(await file.text());
      if(!Array.isArray(data.cards)) throw new Error('Keine gültige Sicherung.');
      if(!confirm(`Sicherung mit ${data.cards.length} Vokabeln einspielen? Der aktuelle Bestand wird ersetzt.`)) return;
      state.cards=data.cards; state.progress=data.progress||{}; state.settings={...defaultState().settings,...(data.settings||{})}; state.ui={chapter:'all',sections:['*']}; saveState(); renderSettings(); toast('Sicherung importiert.');
    } catch(err) { toast(err.message); }
  }

  async function initServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      els.offlineBadge.textContent='Offline nicht unterstützt';
      return;
    }
    try {
      await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready;
      updateOnlineBadge();
    } catch(err) {
      console.error(err);
      els.offlineBadge.textContent='Offline-Setup fehlgeschlagen';
    }
  }

  function updateOnlineBadge() {
    if (!navigator.onLine) {
      els.offlineBadge.textContent='Offline · lokal';
      els.offlineBadge.className='status-badge offline';
    } else if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      els.offlineBadge.textContent='Offline bereit';
      els.offlineBadge.className='status-badge ready';
    } else {
      els.offlineBadge.textContent='Offline wird vorbereitet';
      els.offlineBadge.className='status-badge';
    }
  }

  function initEvents() {
    document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
    window.addEventListener('online',updateOnlineBadge);
    window.addEventListener('offline',updateOnlineBadge);
    navigator.serviceWorker?.addEventListener('controllerchange',updateOnlineBadge);
  }

  seedIfNeeded();
  initEvents();
  renderLearn();
  initServiceWorker();
  updateOnlineBadge();
})();
