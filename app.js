// ── State ──────────────────────────────────────────────
// Global variables that track the app's current state throughout the session
let apiKey = '';               // Stores the user's Groq API key after they save it
let uploadedImages = [];       // Array of base64-encoded images uploaded by the user
let uploadedFileText = null;   // Raw text content from an uploaded .txt/.md file
let selectedTypes = new Set(); // Set of quiz type codes the user has toggled on (e.g. 'mc', 'fc')
let quizData = null;           // Parsed JSON array of quiz questions returned by the AI
let flashcardData = null;      // Parsed JSON array of flashcards returned by the AI
let fcIndex = 0, fcRatings = {}, fcFlipped = false; // Flashcard navigation: current index, per-card ratings, and flip state
let scored = {};               // Tracks which quiz questions the user has answered and whether they were correct
let currentTab = 'text';       // Which input tab is active: 'text', 'file', or 'photo'


// ── API Key ────────────────────────────────────────────
// Reads the key from the input field, saves it to the global apiKey variable,
// and updates the UI to show a green confirmation indicator
function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val) { alert('Please enter a Groq API key.'); return; } // Stop if the field is empty
  apiKey = val; // Save the key into the global state so all API calls can use it
  document.getElementById('api-key-status').style.display = 'inline'; // Show the "✓ Key saved" badge
  document.getElementById('api-key-input').style.borderColor = 'var(--success)'; // Turn the input border green
}


// ── Dark / Light mode ──────────────────────────────────
// Toggles the 'dark' class on <body> to switch between themes,
// updates the button label, and saves the preference to localStorage
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark'); // Add 'dark' if absent, remove if present
  const btn = document.getElementById('theme-btn');
  btn.textContent = isDark ? '☀️ Light mode' : '🌙 Dark mode'; // Flip the button label to match the new state
  localStorage.setItem('sf-theme', isDark ? 'dark' : 'light'); // Persist preference so it survives page refreshes
}

// Runs on page load — checks localStorage for a saved theme preference
// and applies dark mode immediately if it was previously selected
function initTheme() {
  const saved = localStorage.getItem('sf-theme');
  if (saved === 'dark') {
    document.body.classList.add('dark'); // Apply dark mode before the page renders to avoid a flash
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☀️ Light mode';
  }
}

// ── Tab switching ──────────────────────────────────────
// Shows the correct input panel (text / file / photo) and highlights
// the matching tab button when the user clicks between input modes
function switchInput(mode) {
  currentTab = mode; // Update global state so generateContent() knows where to get notes from

  // Hide all three panels first, then reveal only the selected one
  document.getElementById('panel-text').classList.add('hidden');
  document.getElementById('panel-file').classList.add('hidden');
  document.getElementById('panel-photo').classList.add('hidden');
  document.getElementById('panel-' + mode).classList.remove('hidden');

  // Remove 'active' from all tab buttons, then mark the correct one
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const idx = ['text', 'file', 'photo'].indexOf(mode); // Get the position of the selected mode
  document.querySelectorAll('.tab-btn')[idx].classList.add('active');
}

// ── File upload ────────────────────────────────────────
// Handles a .txt or .md file upload — reads it as plain text using FileReader
// and stores the result in uploadedFileText for use during generation
function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return; // Do nothing if no file was selected
  const reader = new FileReader();
  reader.onload = e => {
    uploadedFileText = e.target.result; // Save the raw text so generateContent() can use it
    // Show a preview card below the upload zone with the filename and size
    const prev = document.getElementById('file-preview');
    prev.innerHTML = `<div class="uploaded-preview"><span class="preview-icon">📄</span><div><div class="preview-name">${file.name}</div><div class="preview-size">${(file.size/1024).toFixed(1)} KB</div></div></div>`;
    prev.classList.remove('hidden');
  };
  reader.readAsText(file); // Trigger the read — result comes back in the onload callback above
}

// ── Photo upload (multiple) ────────────────────────────
// Handles one or more image uploads — converts each to base64 using FileReader
// and builds a thumbnail grid preview. The base64 data is later sent to the
// Groq vision model to extract text from the images
function handlePhotoUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  uploadedImages = []; // Reset the image array before loading new files
  const prev = document.getElementById('photo-preview');
  prev.innerHTML = ''; // Clear any previous preview
  prev.classList.remove('hidden');

  // Create a grid container to display thumbnails side by side
  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  prev.appendChild(grid);

  let loaded = 0; // Counter to track when all files have finished loading
  files.forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = e => {
      // Store only the base64 payload (strip the data URL prefix) alongside the MIME type
      uploadedImages[i] = { data: e.target.result.split(',')[1], type: file.type };

      // Build a thumbnail element and add it to the grid
      const thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.innerHTML = `<img src="${e.target.result}" alt="${file.name}"><div class="photo-thumb-name">${file.name}</div>`;
      grid.appendChild(thumb);

      loaded++;
      // Once every file is loaded, show a summary line below the grid
      if (loaded === files.length) {
        const info = document.createElement('div');
        info.className = 'uploaded-preview';
        info.style.marginTop = '8px';
        info.innerHTML = `<span class="preview-icon">🖼️</span><div><div class="preview-name">${files.length} image${files.length > 1 ? 's' : ''} ready</div><div class="preview-size">AI will extract text from all images</div></div>`;
        prev.appendChild(info);
      }
    };
    reader.readAsDataURL(file); // Read as a data URL so we can both preview and extract base64
  });
}

// ── Quiz type toggles ──────────────────────────────────
// Toggles a single quiz type card on or off when clicked.
// selectedTypes is a Set so duplicates are automatically prevented.
function toggleType(t) {
  const el = document.getElementById('type-' + t);
  if (selectedTypes.has(t)) {
    selectedTypes.delete(t);        // Deselect if already active
    el.classList.remove('selected');
  } else {
    selectedTypes.add(t);           // Select if not already active
    el.classList.add('selected');
  }
  // Remove the "all selected" highlight from the ⚡ All combined card
  // since the user has manually changed individual selections
  document.getElementById('type-all').classList.remove('all-selected');
}

// Handles the "All combined" card — if all types are already selected it deselects
// them all; otherwise it selects all five at once
function selectAll() {
  const all = ['mc', 'sa', 'fb', 'ld', 'fc'];
  const allSelected = all.every(t => selectedTypes.has(t)); // Check if every type is currently on
  if (allSelected) {
    // Deselect everything
    all.forEach(t => { selectedTypes.delete(t); document.getElementById('type-' + t).classList.remove('selected'); });
    document.getElementById('type-all').classList.remove('all-selected');
  } else {
    // Select everything and apply the special purple highlight to the "All" card
    all.forEach(t => { selectedTypes.add(t); document.getElementById('type-' + t).classList.add('selected'); });
    document.getElementById('type-all').classList.add('all-selected');
  }
}

// ── Groq API calls ─────────────────────────────────────
// Sends a plain text prompt to Groq's chat completions endpoint
// and returns the model's response as a string
async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message); // Surface API errors to the caller
  return data.choices?.[0]?.message?.content || ''; // Return just the text content of the response
}

// Sends an image (as base64) plus a text prompt to Groq's vision model.
// Used to extract text from uploaded photos of handwritten or printed notes.
async function callGroqVision(prompt, imageData, imageType) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct', // Vision-capable model
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${imageType};base64,${imageData}` } }, // Attach the image
        { type: 'text', text: prompt } // Attach the instruction
      ]}]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || '';
}

// ── Generate ───────────────────────────────────────────
// Main function that runs when the user clicks "Generate study set".
// Validates all inputs, collects the notes text, builds prompts,
// calls the Groq API in parallel, parses the results, and shows them.
async function generateContent() {
  const errEl = document.getElementById('gen-error');
  errEl.classList.add('hidden'); // Clear any previous error message

  // ── Input validation ──
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

  // ── Setup ──
  const qCount = Math.max(1, Math.min(50, parseInt(document.getElementById('q-count').value) || 10)); // Clamp between 1 and 50
  const types = Array.from(selectedTypes);
  const hasFlashcards = types.includes('fc');         // Whether flashcards were requested
  const quizTypes = types.filter(t => t !== 'fc');    // All non-flashcard types
  const flashcardsOnly = quizTypes.length === 0 && hasFlashcards; // True if user only wants flashcards

  // Switch to the loading screen
  document.getElementById('setup-section').classList.add('hidden');
  document.getElementById('loading-section').classList.remove('hidden');

  // Cycle through loading messages every 2 seconds to give the user feedback
  const msgs = ['Analyzing your notes...', 'Crafting questions...', 'Building your study set...', 'Almost done!'];
  let mi = 0;
  const ticker = setInterval(() => { mi = (mi + 1) % msgs.length; document.getElementById('loading-text').textContent = msgs[mi]; }, 2000);

  try {
    // ── Collect notes text ──
    let notesText = '';
    if (currentTab === 'text') {
      notesText = document.getElementById('notes-text').value.trim(); // Use the pasted text directly
    } else if (currentTab === 'file') {
      notesText = uploadedFileText; // Use the file text that was read on upload
    } else {
      // For photos, run each image through the vision model in parallel to extract text,
      // then join all extracted strings together with blank lines between them
      const extractions = await Promise.all(
        uploadedImages.map(img => callGroqVision(
          'Extract all text from this image of notes. Return only the extracted text, nothing else.',
          img.data, img.type
        ))
      );
      notesText = extractions.filter(Boolean).join('\n\n');
    }

    // ── Build and fire API requests in parallel ──
    const typeLabels = { mc: 'multiple_choice', sa: 'short_answer', fb: 'fill_in_blank', ld: 'label_diagram' };
    const typeNames = quizTypes.map(t => typeLabels[t]); // Convert short codes to the labels the AI understands
    const promises = [];

    // Queue a quiz generation request if any non-flashcard types are selected
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

    // Queue a flashcard generation request if flashcards were selected
    if (hasFlashcards) {
      const fcCount = flashcardsOnly ? qCount : Math.ceil(qCount / 2); // Fewer cards when mixed with a quiz
      promises.push(callGroq(`Create ${fcCount} flashcards from these notes.

Notes:
${notesText}

Return ONLY a valid JSON array. No markdown, no backticks. Each item needs:
- "front": question or term
- "back": answer or definition`));
    }

    // Wait for all API calls to finish simultaneously
    const results = await Promise.all(promises);

    // ── Parse responses ──
    let ri = 0; // Index to walk through results in order
    quizData = null; flashcardData = null;

    if (quizTypes.length > 0) {
      // Strip any accidental markdown fences before parsing JSON
      quizData = JSON.parse(results[ri++].replace(/```json|```/g, '').trim());
    }
    if (hasFlashcards) {
      flashcardData = JSON.parse(results[ri].replace(/```json|```/g, '').trim());
    }

    // ── Show results ──
    clearInterval(ticker); // Stop the loading message rotation
    document.getElementById('loading-section').classList.add('hidden');
    showResults(quizTypes, hasFlashcards, flashcardsOnly);

  } catch (err) {
    // If anything went wrong, stop loading, restore the setup form, and show the error
    clearInterval(ticker);
    document.getElementById('loading-section').classList.add('hidden');
    document.getElementById('setup-section').classList.remove('hidden');
    errEl.textContent = 'Error: ' + err.message;
    errEl.classList.remove('hidden');
  }
}

// ── Show results ───────────────────────────────────────
// Decides what to render based on which types were generated,
// then reveals the results section and populates the UI
function showResults(quizTypes, hasFlashcards, flashcardsOnly) {
  document.getElementById('results-section').classList.remove('hidden');

  // If there are quiz questions, set the header text, show the score bar, and render them
  if (!flashcardsOnly && quizData) {
    document.getElementById('results-title').textContent = 'Your Quiz';
    document.getElementById('results-meta').textContent = `${quizData.length} questions generated`;
    document.getElementById('score-bar').classList.remove('hidden');
    renderQuiz();
  }

  // If flashcards were generated, set up the flashcard view
  if (hasFlashcards && flashcardData) {
    if (flashcardsOnly) {
      // If ONLY flashcards were requested, jump straight to the card view
      document.getElementById('results-title').textContent = 'Your Flashcards';
      document.getElementById('results-meta').textContent = `${flashcardData.length} flashcards generated`;
      setView('cards');
    } else {
      // If both quiz and flashcards exist, show the Quiz / Flashcards toggle
      document.getElementById('view-switcher').classList.remove('hidden');
    }
    renderFlashcards();
  }
}

// ── Quiz rendering ─────────────────────────────────────
// Iterates over quizData and builds the HTML for each question block,
// choosing the right input UI based on each question's type
function renderQuiz() {
  const container = document.getElementById('questions-container');
  container.innerHTML = ''; // Clear any previously rendered questions
  scored = {};              // Reset the score tracking object
  updateScore();
  if (!quizData) return;

  quizData.forEach((q, idx) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.id = 'q-block-' + idx;

    // Maps question type strings to CSS badge classes and human-readable labels
    const badgeMap = { multiple_choice: 'badge-mc', short_answer: 'badge-sa', fill_in_blank: 'badge-fb', label_diagram: 'badge-ld' };
    const typeLabel = { multiple_choice: 'Multiple choice', short_answer: 'Short answer', fill_in_blank: 'Fill in blank', label_diagram: 'Label diagram' };

    // Build the question header (number, type badge, question text)
    let html = `<div class="q-header">
      <div class="q-num">Q${idx + 1}</div>
      <span class="q-badge ${badgeMap[q.type] || 'badge-mc'}">${typeLabel[q.type] || q.type}</span>
      <div class="q-text">${q.question}</div>
    </div>`;

    if (q.type === 'multiple_choice') {
      // Render four clickable option buttons labeled A-D
      html += '<div class="mc-options">';
      const letters = ['A', 'B', 'C', 'D'];
      (q.options || []).forEach((opt, oi) => {
        // Escape backslashes and single quotes so the values are safe inside onclick attributes
        const safeOpt = opt.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeAns = q.answer.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        html += `<button class="mc-option" onclick="selectMC(${idx},'${safeOpt}','${safeAns}',this)"><div class="option-letter">${letters[oi]}</div>${opt}</button>`;
      });
      html += '</div>';
    } else if (q.type === 'short_answer') {
      // Render a textarea for the user's answer and a button to reveal the correct answer
      html += `<textarea class="sa-textarea" id="sa-${idx}" placeholder="Type your answer..."></textarea>
        <button class="check-btn" onclick="revealSA(${idx})">Show answer</button>
        <div class="answer-reveal" id="ans-${idx}"><strong>Answer</strong>${q.answer}</div>`;
    } else if (q.type === 'fill_in_blank') {
      // Render a text input and a Check button that compares the user's answer to the correct one
      const safeAns = q.answer.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      html += `<input type="text" class="fill-input" id="fb-${idx}" placeholder="Fill in the blank...">
        <button class="check-btn" onclick="checkFB(${idx},'${safeAns}')">Check</button>
        <div class="answer-reveal" id="ans-${idx}"><strong>Correct answer</strong>${q.answer}</div>`;
    } else if (q.type === 'label_diagram') {
      // Render a text description of the diagram and one input per label
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

// Called when the user clicks a multiple-choice option.
// Locks the question, highlights correct/wrong answers, and updates the score.
function selectMC(idx, chosen, correct, btn) {
  const block = document.getElementById('q-block-' + idx);
  if (block.dataset.answered) return; // Ignore clicks if already answered
  block.dataset.answered = '1';       // Mark the block as answered to prevent further interaction
  block.querySelectorAll('.mc-option').forEach(o => o.disabled = true); // Disable all buttons

  const isCorrect = chosen.trim().toLowerCase() === correct.trim().toLowerCase();
  btn.classList.add(isCorrect ? 'correct-ans' : 'wrong-ans'); // Highlight the clicked button

  if (!isCorrect) {
    // If wrong, also highlight the correct option in green so the user can learn
    block.querySelectorAll('.mc-option').forEach(o => {
      if (o.textContent.replace(/^[A-D]/, '').trim().toLowerCase() === correct.trim().toLowerCase()) o.classList.add('correct-ans');
    });
  }
  block.classList.add(isCorrect ? 'correct' : 'incorrect'); // Add a colored left border to the block
  scored[idx] = isCorrect; // Record the result
  updateScore();
}

// Reveals the model answer for a short-answer question
function revealSA(idx) {
  document.getElementById('ans-' + idx).classList.add('show');
  document.getElementById('q-block-' + idx).classList.add('answered');
}

// Checks a fill-in-the-blank answer using a loose match
// (accepts the user's answer if it contains or is contained by the correct answer)
function checkFB(idx, correct) {
  const inp = document.getElementById('fb-' + idx);
  const val = inp.value.trim().toLowerCase();
  const cor = correct.trim().toLowerCase();
  const isCorrect = val === cor || cor.includes(val) || val.includes(cor); // Lenient matching
  inp.classList.add(isCorrect ? 'correct' : 'incorrect'); // Color the input field
  inp.disabled = true; // Lock the input
  document.getElementById('ans-' + idx).classList.add('show'); // Always show the correct answer
  document.getElementById('q-block-' + idx).classList.add(isCorrect ? 'correct' : 'incorrect');
  scored[idx] = isCorrect;
  updateScore();
}

// Reveals the correct labels for a label-diagram question
function revealLD(idx) {
  document.getElementById('ans-' + idx).classList.add('show');
  document.getElementById('q-block-' + idx).classList.add('answered');
}

// Triggers reveal/check on all unanswered questions at once
function checkAll() {
  if (!quizData) return;
  quizData.forEach((q, idx) => {
    if (scored[idx] === undefined) { // Only act on questions not yet answered
      if (q.type === 'short_answer') revealSA(idx);
      else if (q.type === 'fill_in_blank') checkFB(idx, q.answer);
      else if (q.type === 'label_diagram') revealLD(idx);
    }
  });
}

// Recalculates and displays the current score fraction and progress bar width
function updateScore() {
  const correct = Object.values(scored).filter(v => v === true).length;
  const total = quizData ? quizData.length : 0;
  document.getElementById('score-num').textContent = `${correct}/${total}`;
  document.getElementById('score-fill').style.width = total > 0 ? `${(correct / total) * 100}%` : '0%';
}

// ── Flashcards ─────────────────────────────────────────
// Resets flashcard state and renders the first card and progress dots
function renderFlashcards() {
  fcIndex = 0; fcRatings = {}; fcFlipped = false;
  updateCard(); renderDots();
}

// Updates the visible card content, counter, nav button states,
// and collapses the end-of-deck summary if it was showing
function updateCard() {
  if (!flashcardData?.length) return;
  const card = flashcardData[fcIndex];
  document.getElementById('card-front-text').textContent = card.front;
  document.getElementById('card-back-text').textContent = card.back;
  document.getElementById('flashcard').classList.remove('flipped'); // Always start showing the front
  fcFlipped = false;
  document.getElementById('fc-counter').textContent = `${fcIndex + 1} / ${flashcardData.length}`;
  document.getElementById('fc-prev').disabled = fcIndex === 0;                          // Disable Prev on the first card
  document.getElementById('fc-next').disabled = fcIndex === flashcardData.length - 1;  // Disable Next on the last card
  document.getElementById('fc-rating').style.opacity = '1'; // Restore rating buttons if they were dimmed
  document.getElementById('fc-summary').classList.add('hidden'); // Hide the summary until the deck is complete
  updateDots();
}

// Toggles the CSS 'flipped' class to trigger the 3D card flip animation
function flipCard() {
  fcFlipped = !fcFlipped;
  document.getElementById('flashcard').classList.toggle('flipped', fcFlipped);
}

// Moves to the previous or next card (dir = -1 or 1) within bounds
function fcNav(dir) {
  fcIndex = Math.max(0, Math.min(flashcardData.length - 1, fcIndex + dir));
  updateCard();
}

// Records the user's self-rating for the current card ('know', 'unsure', 'nope'),
// advances to the next card after a short delay, or shows the summary on the last card
function rateCard(rating) {
  fcRatings[fcIndex] = rating; // Store the rating against the card index
  updateDots();
  if (fcIndex < flashcardData.length - 1) {
    setTimeout(() => { fcIndex++; updateCard(); }, 200); // Brief pause before advancing
  } else {
    // Last card rated — tally the results and show the completion summary
    const know = Object.values(fcRatings).filter(r => r === 'know').length;
    const unsure = Object.values(fcRatings).filter(r => r === 'unsure').length;
    const nope = Object.values(fcRatings).filter(r => r === 'nope').length;
    document.getElementById('fc-rating').style.opacity = '0.3'; // Dim the rating buttons
    document.getElementById('fc-stats-row').innerHTML = `
      <div class="stat-chip stat-know">✓ Know it: ${know}</div>
      <div class="stat-chip stat-unsure">~ Almost: ${unsure}</div>
      <div class="stat-chip stat-nope">✗ Review: ${nope}</div>`;
    document.getElementById('fc-summary').classList.remove('hidden');
  }
}

// Clears ratings and restarts the deck from card 1
function restartCards() { fcRatings = {}; renderFlashcards(); }

// Builds the row of small progress dots below the flashcard
function renderDots() {
  if (!flashcardData) return;
  document.getElementById('fc-dots').innerHTML = flashcardData.map((_, i) => `<div class="fc-dot" id="dot-${i}"></div>`).join('');
  updateDots();
}

// Refreshes each dot's CSS classes to reflect the current card index and any stored ratings
function updateDots() {
  if (!flashcardData) return;
  flashcardData.forEach((_, i) => {
    const d = document.getElementById('dot-' + i);
    if (!d) return;
    // Add the rating class (know/unsure/nope) if rated, plus 'current' if it's the active card
    d.className = 'fc-dot' + (fcRatings[i] ? ' ' + fcRatings[i] : '') + (i === fcIndex ? ' current' : '');
  });
}

// ── View switching ─────────────────────────────────────
// Toggles between the quiz view and the flashcard view,
// and shows/hides the score bar accordingly
function setView(v) {
  document.getElementById('quiz-view').classList.toggle('hidden', v !== 'quiz');
  document.getElementById('cards-view').classList.toggle('hidden', v !== 'cards');
  document.getElementById('view-quiz-btn').classList.toggle('active', v === 'quiz');
  document.getElementById('view-cards-btn').classList.toggle('active', v === 'cards');
  document.getElementById('score-bar').classList.toggle('hidden', v !== 'quiz'); // Score bar only makes sense in quiz mode
}

// ── Reset ──────────────────────────────────────────────
// Clears all state, inputs, and generated content, then returns
// the user to the setup screen as if the page had just loaded
function resetAll() {
  // Clear state
  quizData = null; flashcardData = null;
  uploadedImages = []; uploadedFileText = null;
  selectedTypes = new Set(); scored = {};
  fcIndex = 0; fcRatings = {}; fcFlipped = false;

  // Clear inputs
  document.getElementById('notes-text').value = '';
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-preview').innerHTML = '';
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = ''; // Reset file input so the same file can be re-uploaded
  const photoInput = document.getElementById('photo-input');
  if (photoInput) photoInput.value = '';

  // Clear quiz type selections
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected', 'all-selected'));

  // Reset results section fully
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('view-switcher').classList.add('hidden');
  document.getElementById('score-bar').classList.add('hidden');
  document.getElementById('score-num').textContent = '0/0';
  document.getElementById('score-fill').style.width = '0%';
  document.getElementById('questions-container').innerHTML = '';
  document.getElementById('fc-dots').innerHTML = '';
  document.getElementById('fc-summary').classList.add('hidden');
  document.getElementById('fc-stats-row').innerHTML = '';

  // Reset view to quiz (so next time both start fresh)
  document.getElementById('quiz-view').classList.remove('hidden');
  document.getElementById('cards-view').classList.add('hidden');
  document.getElementById('view-quiz-btn').classList.add('active');
  document.getElementById('view-cards-btn').classList.remove('active');

  // Show setup
  document.getElementById('setup-section').classList.remove('hidden');
  switchInput('text'); // Return to the default text input tab
}

// ── PDF Download ───────────────────────────────────────
// Uses jsPDF to generate a formatted PDF of all quiz questions
// and flashcards, then triggers a browser download
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
    let y = margin; // Current vertical cursor position on the page

    // Helper that writes wrapped text at the current y position,
    // automatically adding a new page when the bottom margin is reached
    const addText = (text, size, bold, color) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...(color || [15, 23, 42]));
      doc.splitTextToSize(String(text), contentW).forEach(line => {
        if (y > pageH - margin) { doc.addPage(); y = margin; } // Page break
        doc.text(line, margin, y);
        y += size * 1.4; // Advance cursor by line height
      });
    };

    // PDF header
    addText('StudyForge — Study Set', 20, true, [37, 99, 235]);
    y += 4;
    addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 10, false, [100, 116, 139]);
    y += 14;
    doc.setDrawColor(226, 232, 240); doc.line(margin, y, pageW - margin, y); y += 14; // Horizontal rule

    // Quiz questions section
    if (quizData?.length) {
      addText('QUIZ QUESTIONS', 12, true, [37, 99, 235]); y += 6;
      const labels = { multiple_choice: 'MC', short_answer: 'SA', fill_in_blank: 'FB', label_diagram: 'LD' };
      quizData.forEach((q, i) => {
        if (y > pageH - margin - 60) { doc.addPage(); y = margin; } // Ensure enough room for a question block
        addText(`Q${i + 1}. [${labels[q.type] || q.type}] ${q.question}`, 11, true);
        if (q.type === 'multiple_choice') {
          // List each option on its own indented line
          ['A', 'B', 'C', 'D'].forEach((l, oi) => { if (q.options?.[oi]) addText(`   ${l}. ${q.options[oi]}`, 10, false, [71, 85, 105]); });
        }
        addText(`Answer: ${q.answer}`, 10, false, [5, 150, 105]); y += 6; // Answer in green
      });
      y += 6; doc.setDrawColor(226, 232, 240); doc.line(margin, y, pageW - margin, y); y += 14;
    }

    // Flashcards section
    if (flashcardData?.length) {
      addText('FLASHCARDS', 12, true, [124, 58, 237]); y += 6;
      flashcardData.forEach((fc, i) => {
        if (y > pageH - margin - 40) { doc.addPage(); y = margin; }
        addText(`${i + 1}. ${fc.front}`, 11, true);           // Front of card (term/question)
        addText(`   → ${fc.back}`, 10, false, [71, 85, 105]); y += 4; // Back of card (definition/answer)
      });
    }

    // Page numbers footer on every page
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(9); doc.setTextColor(148, 163, 184);
      doc.text(`StudyForge — Page ${p} of ${pages}`, pageW / 2, pageH - 20, { align: 'center' });
    }
    doc.save('studyforge.pdf'); // Trigger the browser download
  } catch (err) {
    alert('PDF error: ' + err.message);
  }
  btn.textContent = '⬇️ Download PDF';
  btn.disabled = false;
}

// ── Drag and drop ──────────────────────────────────────
// Runs once the DOM is ready. Initialises the theme and wires up
// drag-and-drop support for both the file and photo upload zones.
window.addEventListener('DOMContentLoaded', () => {
  initTheme(); // Apply saved theme before anything is visible
  ['file-zone', 'photo-zone'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });   // Show hover style
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));                        // Remove hover style
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (!files.length) return;
      if (id === 'file-zone') {
        // Inject the dropped file into the hidden file input and trigger the upload handler
        const inp = document.getElementById('file-input');
        const dt = new DataTransfer();
        dt.items.add(files[0]); // Only accept the first file for text uploads
        inp.files = dt.files;
        handleFileUpload(inp);
      } else {
        // Inject all dropped files into the photo input and trigger the upload handler
        const inp = document.getElementById('photo-input');
        const dt = new DataTransfer();
        Array.from(files).forEach(f => dt.items.add(f));
        inp.files = dt.files;
        handlePhotoUpload(inp);
      }
    });
  });
});