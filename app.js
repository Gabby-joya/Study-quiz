// ── State ──────────────────────────────────────────────
let apiKey = '';
let uploadedImages = [];
let uploadedFileText = null;
let selectedTypes = new Set();
let quizData = null;
let flashcardData = null;
let fcIndex = 0, fcRatings = {}, fcFlipped = false;
let scored = {};
let currentTab = 'text';

// ── API Key ────────────────────────────────────────────
function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val) { alert('Please enter a Groq API key.'); return; }
  apiKey = val;
  document.getElementById('api-key-status').style.display = 'inline';
  document.getElementById('api-key-input').style.borderColor = 'var(--success)';
}

// ── Tab switching ──────────────────────────────────────
function switchInput(mode) {
  currentTab = mode;
  document.getElementById('panel-text').classList.add('hidden');
  document.getElementById('panel-file').classList.add('hidden');
  document.getElementById('panel-photo').classList.add('hidden');
  document.getElementById('panel-' + mode).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const idx = ['text', 'file', 'photo'].indexOf(mode);
  document.querySelectorAll('.tab-btn')[idx].classList.add('active');
}

// ── File upload ────────────────────────────────────────
function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    uploadedFileText = e.target.result;
    const prev = document.getElementById('file-preview');
    prev.innerHTML = `<div class="uploaded-preview"><span class="preview-icon">📄</span><div><div class="preview-name">${file.name}</div><div class="preview-size">${(file.size/1024).toFixed(1)} KB</div></div></div>`;
    prev.classList.remove('hidden');
  };
  reader.readAsText(file);
}

// ── Photo upload (multiple) ────────────────────────────
function handlePhotoUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  uploadedImages = [];
  const prev = document.getElementById('photo-preview');
  prev.innerHTML = '';
  prev.classList.remove('hidden');

  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  prev.appendChild(grid);

  let loaded = 0;
  files.forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = e => {
      uploadedImages[i] = { data: e.target.result.split(',')[1], type: file.type };
      const thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.innerHTML = `<img src="${e.target.result}" alt="${file.name}"><div class="photo-thumb-name">${file.name}</div>`;
      grid.appendChild(thumb);
      loaded++;
      if (loaded === files.length) {
        const info = document.createElement('div');
        info.className = 'uploaded-preview';
        info.style.marginTop = '8px';
        info.innerHTML = `<span class="preview-icon">🖼️</span><div><div class="preview-name">${files.length} image${files.length > 1 ? 's' : ''} ready</div><div class="preview-size">AI will extract text from all images</div></div>`;
        prev.appendChild(info);
      }
    };
    reader.readAsDataURL(file);
  });
}

// ── Quiz type toggles ──────────────────────────────────
function toggleType(t) {
  const el = document.getElementById('type-' + t);
  if (selectedTypes.has(t)) {
    selectedTypes.delete(t);
    el.classList.remove('selected');
  } else {
    selectedTypes.add(t);
    el.classList.add('selected');
  }
  document.getElementById('type-all').classList.remove('all-selected');
}

function selectAll() {
  const all = ['mc', 'sa', 'fb', 'ld', 'fc'];
  const allSelected = all.every(t => selectedTypes.has(t));
  if (allSelected) {
    all.forEach(t => { selectedTypes.delete(t); document.getElementById('type-' + t).classList.remove('selected'); });
    document.getElementById('type-all').classList.remove('all-selected');
  } else {
    all.forEach(t => { selectedTypes.add(t); document.getElementById('type-' + t).classList.add('selected'); });
    document.getElementById('type-all').classList.add('all-selected');
  }
}

// ── Groq API calls ─────────────────────────────────────
async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || '';
}

async function callGroqVision(prompt, imageData, imageType) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageData}` } },
        { type: 'text', text: prompt }
      ]}]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || '';
}

// ── Generate ───────────────────────────────────────────
async function generateContent() {
  const errEl = document.getElementById('gen-error');
  errEl.classList.add('hidden');

  if (!apiKey) {
    errEl.textContent = 'Please enter your Groq API key above.';
    errEl.classList.remove('hidden');
    return;
  }
  if (selectedTypes.size === 0) {
    errEl.textContent = 'Please select at least one quiz type.';
    errEl.classList.remove('hidden');
    return;
  }
  if (currentTab === 'text' && !document.getElementById('notes-text').value.trim()) {
    errEl.textContent = 'Please paste your notes in the text box.';
    errEl.classList.remove('hidden');
    return;
  }
  if (currentTab === 'file' && !uploadedFileText) {
    errEl.textContent = 'Please upload a text file.';
    errEl.classList.remove('hidden');
    return;
  }
  if (currentTab === 'photo' && uploadedImages.length === 0) {
    errEl.textContent = 'Please upload at least one photo.';
    errEl.classList.remove('hidden');
    return;
  }

  const qCount = Math.max(1, Math.min(50, parseInt(document.getElementById('q-count').value) || 10));
  const types = Array.from(selectedTypes);
  const hasFlashcards = types.includes('fc');
  const quizTypes = types.filter(t => t !== 'fc');
  const flashcardsOnly = quizTypes.length === 0 && hasFlashcards;

  document.getElementById('setup-section').classList.add('hidden');
  document.getElementById('loading-section').classList.remove('hidden');

  const msgs = ['Analyzing your notes...', 'Crafting questions...', 'Building your study set...', 'Almost done!'];
  let mi = 0;
  const ticker = setInterval(() => { mi = (mi + 1) % msgs.length; document.getElementById('loading-text').textContent = msgs[mi]; }, 2000);

  try {
    let notesText = '';
    if (currentTab === 'text') {
      notesText = document.getElementById('notes-text').value.trim();
    } else if (currentTab === 'file') {
      notesText = uploadedFileText;
    } else {
      const extractions = await Promise.all(
        uploadedImages.map(img => callGroqVision(
          'Extract all text from this image of notes. Return only the extracted text, nothing else.',
          img.data, img.type
        ))
      );
      notesText = extractions.filter(Boolean).join('\n\n');
    }

    const typeLabels = { mc: 'multiple_choice', sa: 'short_answer', fb: 'fill_in_blank', ld: 'label_diagram' };
    const typeNames = quizTypes.map(t => typeLabels[t]);
    const promises = [];

    if (quizTypes.length > 0) {
      promises.push(callGroq(`You are a study quiz generator. Create ${qCount} questions from the notes below using these types: ${typeNames.join(', ')}.

Notes:
${notesText}

Return ONLY a valid JSON array. No markdown, no backticks. Each item needs:
- "type": "multiple_choice" | "short_answer" | "fill_in_blank" | "label_diagram"
- "question": question text (use ___ for blanks in fill_in_blank)
- "answer": correct answer string
- For multiple_choice: "options": array of exactly 4 strings including the correct answer
- For label_diagram: "diagram_description": text description, "labels": array of 3-5 label strings`));
    }

    if (hasFlashcards) {
      const fcCount = flashcardsOnly ? qCount : Math.ceil(qCount / 2);
      promises.push(callGroq(`Create ${fcCount} flashcards from these notes.

Notes:
${notesText}

Return ONLY a valid JSON array. No markdown, no backticks. Each item needs:
- "front": question or term
- "back": answer or definition`));
    }

    const results = await Promise.all(promises);
    let ri = 0;
    quizData = null; flashcardData = null;

    if (quizTypes.length > 0) {
      quizData = JSON.parse(results[ri++].replace(/```json|```/g, '').trim());
    }
    if (hasFlashcards) {
      flashcardData = JSON.parse(results[ri].replace(/```json|```/g, '').trim());
    }

    clearInterval(ticker);
    document.getElementById('loading-section').classList.add('hidden');
    showResults(quizTypes, hasFlashcards, flashcardsOnly);

  } catch (err) {
    clearInterval(ticker);
    document.getElementById('loading-section').classList.add('hidden');
    document.getElementById('setup-section').classList.remove('hidden');
    errEl.textContent = 'Error: ' + err.message;
    errEl.classList.remove('hidden');
  }
}

// ── Show results ───────────────────────────────────────
function showResults(quizTypes, hasFlashcards, flashcardsOnly) {
  document.getElementById('results-section').classList.remove('hidden');

  if (!flashcardsOnly && quizData) {
    document.getElementById('results-title').textContent = 'Your Quiz';
    document.getElementById('results-meta').textContent = `${quizData.length} questions generated`;
    document.getElementById('score-bar').classList.remove('hidden');
    renderQuiz();
  }

  if (hasFlashcards && flashcardData) {
    if (flashcardsOnly) {
      document.getElementById('results-title').textContent = 'Your Flashcards';
      document.getElementById('results-meta').textContent = `${flashcardData.length} flashcards generated`;
      setView('cards');
    } else {
      document.getElementById('view-switcher').classList.remove('hidden');
    }
    renderFlashcards();
  }
}

// ── Quiz rendering ─────────────────────────────────────
function renderQuiz() {
  const container = document.getElementById('questions-container');
  container.innerHTML = '';
  scored = {};
  updateScore();
  if (!quizData) return;

  quizData.forEach((q, idx) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.id = 'q-block-' + idx;
    const badgeMap = { multiple_choice: 'badge-mc', short_answer: 'badge-sa', fill_in_blank: 'badge-fb', label_diagram: 'badge-ld' };
    const typeLabel = { multiple_choice: 'Multiple choice', short_answer: 'Short answer', fill_in_blank: 'Fill in blank', label_diagram: 'Label diagram' };

    let html = `<div class="q-header">
      <div class="q-num">Q${idx + 1}</div>
      <span class="q-badge ${badgeMap[q.type] || 'badge-mc'}">${typeLabel[q.type] || q.type}</span>
      <div class="q-text">${q.question}</div>
    </div>`;

    if (q.type === 'multiple_choice') {
      html += '<div class="mc-options">';
      const letters = ['A', 'B', 'C', 'D'];
      (q.options || []).forEach((opt, oi) => {
        const safeOpt = opt.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeAns = q.answer.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        html += `<button class="mc-option" onclick="selectMC(${idx},'${safeOpt}','${safeAns}',this)"><div class="option-letter">${letters[oi]}</div>${opt}</button>`;
      });
      html += '</div>';
    } else if (q.type === 'short_answer') {
      html += `<textarea class="sa-textarea" id="sa-${idx}" placeholder="Type your answer..."></textarea>
        <button class="check-btn" onclick="revealSA(${idx})">Show answer</button>
        <div class="answer-reveal" id="ans-${idx}"><strong>Answer</strong>${q.answer}</div>`;
    } else if (q.type === 'fill_in_blank') {
      const safeAns = q.answer.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      html += `<input type="text" class="fill-input" id="fb-${idx}" placeholder="Fill in the blank...">
        <button class="check-btn" onclick="checkFB(${idx},'${safeAns}')">Check</button>
        <div class="answer-reveal" id="ans-${idx}"><strong>Correct answer</strong>${q.answer}</div>`;
    } else if (q.type === 'label_diagram') {
      html += `<div class="diagram-area">📐 ${q.diagram_description || 'Refer to the diagram.'}</div><div class="label-inputs">`;
      (q.labels || []).forEach((_, li) => {
        html += `<div class="label-row"><div class="label-key">${li + 1}.</div><input type="text" class="fill-input" placeholder="Label ${li + 1}..." id="ld-${idx}-${li}"></div>`;
      });
      html += `</div><button class="check-btn" onclick="revealLD(${idx})">Show labels</button>
        <div class="answer-reveal" id="ans-${idx}"><strong>Correct labels</strong>${(q.labels || []).join(', ')}</div>`;
    }

    block.innerHTML = html;
    container.appendChild(block);
  });
}

function selectMC(idx, chosen, correct, btn) {
  const block = document.getElementById('q-block-' + idx);
  if (block.dataset.answered) return;
  block.dataset.answered = '1';
  block.querySelectorAll('.mc-option').forEach(o => o.disabled = true);
  const isCorrect = chosen.trim().toLowerCase() === correct.trim().toLowerCase();
  btn.classList.add(isCorrect ? 'correct-ans' : 'wrong-ans');
  if (!isCorrect) {
    block.querySelectorAll('.mc-option').forEach(o => {
      if (o.textContent.replace(/^[A-D]/, '').trim().toLowerCase() === correct.trim().toLowerCase()) o.classList.add('correct-ans');
    });
  }
  block.classList.add(isCorrect ? 'correct' : 'incorrect');
  scored[idx] = isCorrect;
  updateScore();
}

function revealSA(idx) {
  document.getElementById('ans-' + idx).classList.add('show');
  document.getElementById('q-block-' + idx).classList.add('answered');
}

function checkFB(idx, correct) {
  const inp = document.getElementById('fb-' + idx);
  const val = inp.value.trim().toLowerCase();
  const cor = correct.trim().toLowerCase();
  const isCorrect = val === cor || cor.includes(val) || val.includes(cor);
  inp.classList.add(isCorrect ? 'correct' : 'incorrect');
  inp.disabled = true;
  document.getElementById('ans-' + idx).classList.add('show');
  document.getElementById('q-block-' + idx).classList.add(isCorrect ? 'correct' : 'incorrect');
  scored[idx] = isCorrect;
  updateScore();
}

function revealLD(idx) {
  document.getElementById('ans-' + idx).classList.add('show');
  document.getElementById('q-block-' + idx).classList.add('answered');
}

function checkAll() {
  if (!quizData) return;
  quizData.forEach((q, idx) => {
    if (scored[idx] === undefined) {
      if (q.type === 'short_answer') revealSA(idx);
      else if (q.type === 'fill_in_blank') checkFB(idx, q.answer);
      else if (q.type === 'label_diagram') revealLD(idx);
    }
  });
}

function updateScore() {
  const correct = Object.values(scored).filter(v => v === true).length;
  const total = quizData ? quizData.length : 0;
  document.getElementById('score-num').textContent = `${correct}/${total}`;
  document.getElementById('score-fill').style.width = total > 0 ? `${(correct / total) * 100}%` : '0%';
}

// ── Flashcards ─────────────────────────────────────────
function renderFlashcards() {
  fcIndex = 0; fcRatings = {}; fcFlipped = false;
  updateCard(); renderDots();
}

function updateCard() {
  if (!flashcardData?.length) return;
  const card = flashcardData[fcIndex];
  document.getElementById('card-front-text').textContent = card.front;
  document.getElementById('card-back-text').textContent = card.back;
  document.getElementById('flashcard').classList.remove('flipped');
  fcFlipped = false;
  document.getElementById('fc-counter').textContent = `${fcIndex + 1} / ${flashcardData.length}`;
  document.getElementById('fc-prev').disabled = fcIndex === 0;
  document.getElementById('fc-next').disabled = fcIndex === flashcardData.length - 1;
  document.getElementById('fc-rating').style.opacity = '1';
  document.getElementById('fc-summary').classList.add('hidden');
  updateDots();
}

function flipCard() {
  fcFlipped = !fcFlipped;
  document.getElementById('flashcard').classList.toggle('flipped', fcFlipped);
}

function fcNav(dir) {
  fcIndex = Math.max(0, Math.min(flashcardData.length - 1, fcIndex + dir));
  updateCard();
}

function rateCard(rating) {
  fcRatings[fcIndex] = rating;
  updateDots();
  if (fcIndex < flashcardData.length - 1) {
    setTimeout(() => { fcIndex++; updateCard(); }, 200);
  } else {
    const know = Object.values(fcRatings).filter(r => r === 'know').length;
    const unsure = Object.values(fcRatings).filter(r => r === 'unsure').length;
    const nope = Object.values(fcRatings).filter(r => r === 'nope').length;
    document.getElementById('fc-rating').style.opacity = '0.3';
    document.getElementById('fc-stats-row').innerHTML = `
      <div class="stat-chip stat-know">✓ Know it: ${know}</div>
      <div class="stat-chip stat-unsure">~ Almost: ${unsure}</div>
      <div class="stat-chip stat-nope">✗ Review: ${nope}</div>`;
    document.getElementById('fc-summary').classList.remove('hidden');
  }
}

function restartCards() { fcRatings = {}; renderFlashcards(); }

function renderDots() {
  if (!flashcardData) return;
  document.getElementById('fc-dots').innerHTML = flashcardData.map((_, i) => `<div class="fc-dot" id="dot-${i}"></div>`).join('');
  updateDots();
}

function updateDots() {
  if (!flashcardData) return;
  flashcardData.forEach((_, i) => {
    const d = document.getElementById('dot-' + i);
    if (!d) return;
    d.className = 'fc-dot' + (fcRatings[i] ? ' ' + fcRatings[i] : '') + (i === fcIndex ? ' current' : '');
  });
}

// ── View switching ─────────────────────────────────────
function setView(v) {
  document.getElementById('quiz-view').classList.toggle('hidden', v !== 'quiz');
  document.getElementById('cards-view').classList.toggle('hidden', v !== 'cards');
  document.getElementById('view-quiz-btn').classList.toggle('active', v === 'quiz');
  document.getElementById('view-cards-btn').classList.toggle('active', v === 'cards');
  document.getElementById('score-bar').classList.toggle('hidden', v !== 'quiz');
}

// ── Reset ──────────────────────────────────────────────
function resetAll() {
  quizData = null; flashcardData = null;
  uploadedImages = []; uploadedFileText = null;
  selectedTypes = new Set(); scored = {};
  document.getElementById('notes-text').value = '';
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-preview').innerHTML = '';
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected', 'all-selected'));
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('view-switcher').classList.add('hidden');
  document.getElementById('score-bar').classList.add('hidden');
  document.getElementById('setup-section').classList.remove('hidden');
  switchInput('text');
}

// ── PDF Download ───────────────────────────────────────
async function downloadPDF() {
  const btn = document.getElementById('pdf-btn');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40, contentW = pageW - margin * 2;
    let y = margin;

    const addText = (text, size, bold, color) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...(color || [15, 23, 42]));
      doc.splitTextToSize(String(text), contentW).forEach(line => {
        if (y > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += size * 1.4;
      });
    };

    addText('StudyForge — Study Set', 20, true, [37, 99, 235]);
    y += 4;
    addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 10, false, [100, 116, 139]);
    y += 14;
    doc.setDrawColor(226, 232, 240); doc.line(margin, y, pageW - margin, y); y += 14;

    if (quizData?.length) {
      addText('QUIZ QUESTIONS', 12, true, [37, 99, 235]); y += 6;
      const labels = { multiple_choice: 'MC', short_answer: 'SA', fill_in_blank: 'FB', label_diagram: 'LD' };
      quizData.forEach((q, i) => {
        if (y > pageH - margin - 60) { doc.addPage(); y = margin; }
        addText(`Q${i + 1}. [${labels[q.type] || q.type}] ${q.question}`, 11, true);
        if (q.type === 'multiple_choice') {
          ['A', 'B', 'C', 'D'].forEach((l, oi) => { if (q.options?.[oi]) addText(`   ${l}. ${q.options[oi]}`, 10, false, [71, 85, 105]); });
        }
        addText(`Answer: ${q.answer}`, 10, false, [5, 150, 105]); y += 6;
      });
      y += 6; doc.setDrawColor(226, 232, 240); doc.line(margin, y, pageW - margin, y); y += 14;
    }

    if (flashcardData?.length) {
      addText('FLASHCARDS', 12, true, [124, 58, 237]); y += 6;
      flashcardData.forEach((fc, i) => {
        if (y > pageH - margin - 40) { doc.addPage(); y = margin; }
        addText(`${i + 1}. ${fc.front}`, 11, true);
        addText(`   → ${fc.back}`, 10, false, [71, 85, 105]); y += 4;
      });
    }

    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(9); doc.setTextColor(148, 163, 184);
      doc.text(`StudyForge — Page ${p} of ${pages}`, pageW / 2, pageH - 20, { align: 'center' });
    }
    doc.save('studyforge.pdf');
  } catch (err) {
    alert('PDF error: ' + err.message);
  }
  btn.textContent = '⬇️ Download PDF';
  btn.disabled = false;
}

// ── Drag and drop ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  ['file-zone', 'photo-zone'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (!files.length) return;
      if (id === 'file-zone') {
        const inp = document.getElementById('file-input');
        const dt = new DataTransfer();
        dt.items.add(files[0]);
        inp.files = dt.files;
        handleFileUpload(inp);
      } else {
        const inp = document.getElementById('photo-input');
        const dt = new DataTransfer();
        Array.from(files).forEach(f => dt.items.add(f));
        inp.files = dt.files;
        handlePhotoUpload(inp);
      }
    });
  });
});