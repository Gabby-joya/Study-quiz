let apiKey = '';

function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if(!val) {
    alert('Please enter a valid Google Gemini API key.');
    return;
  }
  apiKey = val;
  document.getElementById('api-key-status').style.display = 'inline';
  document.getElementById('api-key-input').style.borderColor = 'var(--success)';
}

async function callGemini(prompt, imagePart) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const parts = imagePart
    ? [imagePart, { text: prompt }]
    : [{ text: prompt }];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

let uploadedImageData = null;
let uploadedImageType = null;
let uploadedFileText = null;
let selectedTypes = new Set();
let quizData = null;
let flashcardData = null;
let fcIndex = 0;
let fcRatings = {};
let fcFlipped = false;
let scored = {};
let totalScore = 0;
let scoredCount = 0;

function switchInput(mode) {
  document.querySelectorAll('#input-tabs .tab-btn').forEach((b,i)=>b.classList.remove('active'));
  const tabs = document.querySelectorAll('#input-tabs .tab-btn');
  const idx = ['text','file','photo'].indexOf(mode);
  tabs[idx].classList.add('active');
  ['input-text','input-file','input-photo'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('input-'+mode).classList.remove('hidden');
}

function toggleType(t) {
  if(t==='all') return;
  const el = document.getElementById('type-'+t);
  if(selectedTypes.has(t)) {
    selectedTypes.delete(t);
    el.classList.remove('selected');
  } else {
    selectedTypes.add(t);
    el.classList.add('selected');
  }
  document.getElementById('type-all').classList.remove('all-selected');
}

function selectAll() {
  const all = ['mc','sa','fb','ld','fc'];
  const allSelected = all.every(t=>selectedTypes.has(t));
  if(allSelected) {
    all.forEach(t=>{ selectedTypes.delete(t); document.getElementById('type-'+t).classList.remove('selected'); });
    document.getElementById('type-all').classList.remove('all-selected');
  } else {
    all.forEach(t=>{ selectedTypes.add(t); document.getElementById('type-'+t).classList.add('selected'); });
    document.getElementById('type-all').classList.add('all-selected');
  }
}

function handleFileUpload(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    uploadedFileText = e.target.result;
    const prev = document.getElementById('file-preview');
    prev.innerHTML = `<div class="uploaded-preview"><span class="preview-icon">📄</span><div><div class="preview-name">${file.name}</div><div class="preview-size">${(file.size/1024).toFixed(1)} KB</div></div></div>`;
    prev.classList.remove('hidden');
  };
  reader.readAsText(file);
}

function handlePhotoUpload(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    uploadedImageData = base64;
    uploadedImageType = file.type;
    const prev = document.getElementById('photo-preview');
    prev.innerHTML = `<div style="margin-top:12px;"><img src="${e.target.result}" style="max-height:180px;border-radius:8px;border:1px solid var(--border);max-width:100%;" /><div class="uploaded-preview" style="margin-top:8px;"><span class="preview-icon">🖼️</span><div><div class="preview-name">${file.name}</div><div class="preview-size">${(file.size/1024).toFixed(1)} KB</div></div></div></div>`;
    prev.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function getNotesContent() {
  const activeTab = document.querySelector('#input-tabs .tab-btn.active');
  const mode = ['text','file','photo'][Array.from(document.querySelectorAll('#input-tabs .tab-btn')).indexOf(activeTab)];
  if(mode==='text') return { type:'text', content: document.getElementById('notes-text').value.trim() };
  if(mode==='file') return { type:'text', content: uploadedFileText||'' };
  if(mode==='photo') return { type:'photo', imageData: uploadedImageData, imageType: uploadedImageType };
  return { type:'text', content:'' };
}

async function generateContent() {
  const errEl = document.getElementById('gen-error');
  errEl.classList.add('hidden');

  if(!apiKey) {
    errEl.textContent = 'Please enter your Gemini API key in the banner above.';
    errEl.classList.remove('hidden');
    document.getElementById('api-key-input').focus();
    return;
  }

  if(selectedTypes.size===0) {
    errEl.textContent = 'Please select at least one quiz type.';
    errEl.classList.remove('hidden');
    return;
  }

  const notes = getNotesContent();
  if(notes.type==='text' && !notes.content) {
    errEl.textContent = 'Please add your notes — paste text, upload a file, or take a photo.';
    errEl.classList.remove('hidden');
    return;
  }
  if(notes.type==='photo' && !notes.imageData) {
    errEl.textContent = 'Please upload a photo of your notes.';
    errEl.classList.remove('hidden');
    return;
  }

  const qCount = parseInt(document.getElementById('q-count').value);
  const types = Array.from(selectedTypes);
  const flashcardsOnly = types.length===1 && types[0]==='fc';
  const hasFlashcards = types.includes('fc');
  const quizTypes = types.filter(t=>t!=='fc');

  document.getElementById('setup-section').classList.add('hidden');
  document.getElementById('loading-section').classList.remove('hidden');

  const loadingMsgs = ['Analyzing your notes...','Crafting questions...','Building your study set...','Almost done!'];
  let li = 0;
  const lInterval = setInterval(()=>{ li=(li+1)%loadingMsgs.length; document.getElementById('loading-text').textContent=loadingMsgs[li]; }, 2000);

  try {
    const typeLabels = { mc:'multiple_choice', sa:'short_answer', fb:'fill_in_blank', ld:'label_diagram' };
    const typeNames = quizTypes.map(t=>typeLabels[t]);

    let notesText = '';
    let imagePart = null;

    if(notes.type==='photo') {
      imagePart = { inline_data: { mime_type: notes.imageType, data: notes.imageData } };
      notesText = await callGemini(
        'Please extract all the text from this image of handwritten or printed notes. Return only the extracted text, nothing else.',
        imagePart
      );
    } else {
      notesText = notes.content;
    }

    const promises = [];

    if(quizTypes.length > 0) {
      const qPrompt = `You are a study quiz generator. Given the following notes, create ${qCount} study questions. Use these types: ${typeNames.join(', ')}.

Notes:
${notesText}

Return ONLY a JSON array. No markdown, no backticks, no explanation. Each item must have:
- "type": one of "multiple_choice" | "short_answer" | "fill_in_blank" | "label_diagram"
- "question": the question text (for fill_in_blank, put ___ where the blank is)
- "answer": the correct answer
- For multiple_choice only: "options": array of exactly 4 strings (include the correct answer)
- For label_diagram only: "diagram_description": describe a simple diagram in text, "labels": array of 3-5 strings the student must identify

Distribute question types roughly evenly. Return valid JSON only.`;
      promises.push(callGemini(qPrompt));
    }

    if(hasFlashcards) {
      const fcCount = flashcardsOnly ? qCount : Math.ceil(qCount/2);
      const fcPrompt = `You are a flashcard generator. Given the following notes, create ${fcCount} flashcards for studying.

Notes:
${notesText}

Return ONLY a JSON array. No markdown, no backticks, no explanation. Each item must have:
- "front": the question or term (keep it concise)
- "back": the answer or definition

Return valid JSON only.`;
      promises.push(callGemini(fcPrompt));
    }

    const results = await Promise.all(promises);
    let rIdx = 0;

    let qData = null, fcData = null;

    if(quizTypes.length > 0) {
      const clean = results[rIdx++].replace(/```json|```/g,'').trim();
      qData = JSON.parse(clean);
    }

    if(hasFlashcards) {
      const clean = results[rIdx].replace(/```json|```/g,'').trim();
      fcData = JSON.parse(clean);
    }

    quizData = qData;
    flashcardData = fcData;

    clearInterval(lInterval);
    document.getElementById('loading-section').classList.add('hidden');
    showResults(quizTypes, hasFlashcards, notesText);

  } catch(err) {
    clearInterval(lInterval);
    document.getElementById('loading-section').classList.add('hidden');
    document.getElementById('setup-section').classList.remove('hidden');
    errEl.textContent = 'Something went wrong: ' + err.message + '. Please try again.';
    errEl.classList.remove('hidden');
  }
}

function showResults(quizTypes, hasFlashcards, notesText) {
  const resultsSection = document.getElementById('results-section');
  resultsSection.classList.remove('hidden');

  const flashcardsOnly = quizTypes.length===0 && hasFlashcards;

  if(!flashcardsOnly && quizData) {
    document.getElementById('results-title').textContent = 'Your Quiz';
    document.getElementById('results-meta').textContent = `${quizData.length} questions generated from your notes`;
    document.getElementById('score-bar').classList.remove('hidden');
    renderQuiz();
  }

  if(hasFlashcards && flashcardData) {
    if(flashcardsOnly) {
      document.getElementById('results-title').textContent = 'Your Flashcards';
      document.getElementById('results-meta').textContent = `${flashcardData.length} flashcards generated`;
      setView('cards');
    } else {
      document.getElementById('view-switcher').style.display = 'flex';
    }
    renderFlashcards();
  }
}

function renderQuiz() {
  const container = document.getElementById('questions-container');
  container.innerHTML = '';
  scored = {};
  totalScore = 0;
  scoredCount = 0;
  updateScore();

  if(!quizData) return;

  quizData.forEach((q, idx) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.id = 'q-block-'+idx;

    const badgeMap = { multiple_choice:'badge-mc', short_answer:'badge-sa', fill_in_blank:'badge-fb', label_diagram:'badge-ld' };
    const typeLabel = { multiple_choice:'Multiple choice', short_answer:'Short answer', fill_in_blank:'Fill in blank', label_diagram:'Label diagram' };

    let innerHTML = `<div class="q-header">
      <div class="q-num">Q${idx+1}</div>
      <span class="q-badge ${badgeMap[q.type]||'badge-mc'}">${typeLabel[q.type]||q.type}</span>
      <div class="q-text">${q.question}</div>
    </div>`;

    if(q.type==='multiple_choice') {
      const letters = ['A','B','C','D'];
      innerHTML += `<div class="mc-options">`;
      (q.options||[]).forEach((opt,oi)=>{
        innerHTML += `<button class="mc-option" onclick="selectMC(${idx}, '${opt.replace(/'/g,"\\'")}', '${q.answer.replace(/'/g,"\\'")}', this)"><div class="option-letter">${letters[oi]}</div> ${opt}</button>`;
      });
      innerHTML += `</div>`;
    } else if(q.type==='short_answer') {
      innerHTML += `<textarea class="sa-textarea" placeholder="Type your answer here..." id="sa-${idx}"></textarea>`;
      innerHTML += `<button class="check-btn" onclick="revealSA(${idx})">Show answer</button>`;
      innerHTML += `<div class="answer-reveal" id="ans-${idx}"><strong>Answer</strong>${q.answer}</div>`;
    } else if(q.type==='fill_in_blank') {
      innerHTML += `<input type="text" class="fill-input" placeholder="Fill in the blank..." id="fb-${idx}" />`;
      innerHTML += `<button class="check-btn" onclick="checkFB(${idx}, '${q.answer.replace(/'/g,"\\'")}')">Check</button>`;
      innerHTML += `<div class="answer-reveal" id="ans-${idx}"><strong>Correct answer</strong>${q.answer}</div>`;
    } else if(q.type==='label_diagram') {
      innerHTML += `<div class="diagram-area">📐 ${q.diagram_description||'Refer to the diagram in your notes.'}</div>`;
      innerHTML += `<div class="label-inputs">`;
      (q.labels||[]).forEach((lbl,li)=>{
        innerHTML += `<div class="label-row"><div class="label-key">${li+1}.</div><input type="text" class="fill-input label-input" placeholder="Label ${li+1}..." id="ld-${idx}-${li}" /></div>`;
      });
      innerHTML += `</div>`;
      innerHTML += `<button class="check-btn" onclick="revealLD(${idx})">Show labels</button>`;
      innerHTML += `<div class="answer-reveal" id="ans-${idx}"><strong>Correct labels</strong>${(q.labels||[]).join(', ')}</div>`;
    }

    block.innerHTML = innerHTML;
    container.appendChild(block);
  });
}

function selectMC(idx, chosen, correct, btn) {
  const block = document.getElementById('q-block-'+idx);
  if(block.dataset.answered) return;
  block.dataset.answered = '1';
  const opts = block.querySelectorAll('.mc-option');
  opts.forEach(o=>o.disabled=true);
  const isCorrect = chosen.trim().toLowerCase()===correct.trim().toLowerCase();
  btn.classList.add(isCorrect?'correct-ans':'wrong-ans');
  if(!isCorrect) {
    opts.forEach(o=>{ if(o.textContent.trim().replace(/^[A-D]\s*/,'').toLowerCase()===correct.trim().toLowerCase()) o.classList.add('correct-ans'); });
  }
  block.classList.add(isCorrect?'correct':'incorrect');
  scored[idx] = isCorrect;
  updateScore();
}

function revealSA(idx) {
  document.getElementById('ans-'+idx).classList.add('show');
  document.getElementById('q-block-'+idx).classList.add('answered');
}

function checkFB(idx, correct) {
  const inp = document.getElementById('fb-'+idx);
  const val = inp.value.trim().toLowerCase();
  const cor = correct.trim().toLowerCase();
  const isCorrect = val===cor || cor.includes(val) || val.includes(cor);
  inp.classList.add(isCorrect?'correct':'incorrect');
  inp.disabled = true;
  document.getElementById('ans-'+idx).classList.add('show');
  document.getElementById('q-block-'+idx).classList.add(isCorrect?'correct':'incorrect');
  scored[idx] = isCorrect;
  updateScore();
}

function revealLD(idx) {
  document.getElementById('ans-'+idx).classList.add('show');
  document.getElementById('q-block-'+idx).classList.add('answered');
}

function checkAll() {
  if(!quizData) return;
  quizData.forEach((q,idx)=>{
    if(scored[idx]===undefined) {
      if(q.type==='short_answer') revealSA(idx);
      else if(q.type==='fill_in_blank') checkFB(idx, q.answer);
      else if(q.type==='label_diagram') revealLD(idx);
    }
  });
}

function updateScore() {
  const vals = Object.values(scored);
  const correct = vals.filter(v=>v===true).length;
  const total = quizData ? quizData.length : 0;
  document.getElementById('score-num').textContent = `${correct}/${total}`;
  document.getElementById('score-fill').style.width = total>0 ? `${(correct/total)*100}%` : '0%';
}

function renderFlashcards() {
  fcIndex = 0;
  fcRatings = {};
  fcFlipped = false;
  updateCard();
  renderDots();
}

function updateCard() {
  if(!flashcardData || !flashcardData.length) return;
  const card = flashcardData[fcIndex];
  document.getElementById('card-front-text').textContent = card.front;
  document.getElementById('card-back-text').textContent = card.back;
  document.getElementById('flashcard').classList.remove('flipped');
  fcFlipped = false;
  document.getElementById('fc-counter').textContent = `${fcIndex+1} / ${flashcardData.length}`;
  document.getElementById('fc-prev').disabled = fcIndex===0;
  document.getElementById('fc-next').disabled = fcIndex===flashcardData.length-1;
  updateDots();
  document.getElementById('fc-rating').style.opacity='1';
  document.getElementById('fc-summary').classList.add('hidden');
}

function flipCard() {
  fcFlipped = !fcFlipped;
  document.getElementById('flashcard').classList.toggle('flipped', fcFlipped);
}

function fcNav(dir) {
  fcIndex = Math.max(0, Math.min(flashcardData.length-1, fcIndex+dir));
  updateCard();
}

function rateCard(rating) {
  fcRatings[fcIndex] = rating;
  updateDots();
  if(fcIndex < flashcardData.length-1) {
    setTimeout(()=>{ fcIndex++; updateCard(); }, 200);
  } else {
    showFCSummary();
  }
}

function showFCSummary() {
  document.getElementById('fc-rating').style.opacity='0.3';
  const know = Object.values(fcRatings).filter(r=>r==='know').length;
  const unsure = Object.values(fcRatings).filter(r=>r==='unsure').length;
  const nope = Object.values(fcRatings).filter(r=>r==='nope').length;
  document.getElementById('fc-stats-row').innerHTML = `
    <div class="stat-chip stat-know">✓ Know it: ${know}</div>
    <div class="stat-chip stat-unsure">~ Almost: ${unsure}</div>
    <div class="stat-chip stat-nope">✗ Review: ${nope}</div>
  `;
  document.getElementById('fc-summary').classList.remove('hidden');
}

function restartCards() {
  fcRatings = {};
  renderFlashcards();
}

function renderDots() {
  if(!flashcardData) return;
  const dotsEl = document.getElementById('fc-dots');
  dotsEl.innerHTML = flashcardData.map((_,i)=>`<div class="fc-dot" id="dot-${i}"></div>`).join('');
  updateDots();
}

function updateDots() {
  if(!flashcardData) return;
  flashcardData.forEach((_,i)=>{
    const d = document.getElementById('dot-'+i);
    if(!d) return;
    d.className = 'fc-dot';
    if(fcRatings[i]) d.classList.add(fcRatings[i]);
    if(i===fcIndex) d.classList.add('current');
  });
}

function setView(v) {
  document.getElementById('quiz-view').classList.toggle('hidden', v!=='quiz');
  document.getElementById('cards-view').classList.toggle('hidden', v!=='cards');
  document.getElementById('view-quiz-btn').classList.toggle('active', v==='quiz');
  document.getElementById('view-cards-btn').classList.toggle('active', v==='cards');
  document.getElementById('score-bar').classList.toggle('hidden', v!=='quiz');
}

function resetAll() {
  quizData = null; flashcardData = null;
  uploadedImageData = null; uploadedFileText = null;
  selectedTypes = new Set();
  scored = {};
  document.querySelectorAll('.type-card').forEach(c=>c.classList.remove('selected','all-selected'));
  document.getElementById('notes-text').value = '';
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('view-switcher').style.display='none';
  document.getElementById('score-bar').classList.add('hidden');
  document.getElementById('setup-section').classList.remove('hidden');
  switchInput('text');
}

// Drag and drop
['file-zone','photo-zone'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');});
  el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
  el.addEventListener('drop',e=>{
    e.preventDefault();el.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if(!file) return;
    if(id==='file-zone') { const inp=document.getElementById('file-input'); const dt=new DataTransfer(); dt.items.add(file); inp.files=dt.files; handleFileUpload(inp); }
    else { const inp=document.getElementById('photo-input'); const dt=new DataTransfer(); dt.items.add(file); inp.files=dt.files; handlePhotoUpload(inp); }
  });
});
