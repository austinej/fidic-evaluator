// ============================================
// FIDIC Contract Evaluator - Application Logic
// ============================================

// ---- State ----
const state = {
  apiKey: '',
  mode: '',
  overlay: 'pure-fidic',
  fileName: '',
  contractText: '',
  rules: [],
  results: [],
  currentScreen: 'setup'
};

// ---- DOM References ----
const screens = {
  setup: document.getElementById('screen-setup'),
  progress: document.getElementById('screen-progress'),
  report: document.getElementById('screen-report')
};

// ---- Initialise ----
document.addEventListener('DOMContentLoaded', async () => {
  await loadRules();
  restoreApiKey();
  setupEventListeners();
});

async function loadRules() {
  try {
    const res = await fetch('fidic-rules.json');
    const data = await res.json();
    state.rules = data.rules;
  } catch (e) {
    alert('Error loading FIDIC rules. Please refresh the page.');
  }
}

function restoreApiKey() {
  const saved = localStorage.getItem('fidic_api_key');
  if (saved) {
    document.getElementById('api-key-input').value = saved;
    state.apiKey = saved;
  }
}

function setupEventListeners() {
  // API Key
  document.getElementById('save-key-btn').addEventListener('click', saveApiKey);

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });
  });

  // Overlay buttons
  document.querySelectorAll('.overlay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.overlay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.overlay = btn.dataset.overlay;
    });
  });

  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

  // Analyse button
  document.getElementById('analyse-btn').addEventListener('click', startAnalysis);

  // Summary card clicks
  document.getElementById('score-card').addEventListener('click', () => openDrawer('score'));
  document.getElementById('risk-card').addEventListener('click', () => openDrawer('risk'));
  document.getElementById('critical-card').addEventListener('click', () => openDrawer('critical'));
  document.getElementById('missing-card').addEventListener('click', () => openDrawer('missing'));

  // Drawer close
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('drawer-overlay')) closeDrawer();
  });

  // New analysis
  document.getElementById('new-analysis-btn').addEventListener('click', resetToSetup);
}

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key.startsWith('sk-')) {
    alert('Please enter a valid OpenAI API key starting with sk-');
    return;
  }
  state.apiKey = key;
  localStorage.setItem('fidic_api_key', key);
  const btn = document.getElementById('save-key-btn');
  btn.textContent = '✓ Saved';
  btn.style.background = '#2e7d32';
  setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 2000);
}

// ---- File Handling ----
async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') {
    alert('Please upload a PDF file.');
    return;
  }

  state.fileName = file.name;
  const dropZone = document.getElementById('drop-zone');
  dropZone.classList.add('file-loaded');
  dropZone.innerHTML = `
    <div class="dz-icon">✅</div>
    <div class="dz-title">${file.name}</div>
    <div class="dz-sub">PDF loaded — ${(file.size / 1024).toFixed(0)} KB · Click to change file</div>
  `;

  try {
    state.contractText = await extractPDFText(file);
  } catch (e) {
    alert('Could not read this PDF. Please ensure it is a text-based PDF (not a scanned image).');
    resetDropZone();
  }
}

async function extractPDFText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const typedArray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = '';
        for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map(item => item.str).join(' ') + '\n';
        }
        resolve(fullText.trim());
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function resetDropZone() {
  state.fileName = '';
  state.contractText = '';
  const dropZone = document.getElementById('drop-zone');
  dropZone.classList.remove('file-loaded');
  dropZone.innerHTML = `
    <div class="dz-icon">📄</div>
    <div class="dz-title">Drop your contract PDF here</div>
    <div class="dz-sub">or click to browse · PDF files only</div>
  `;
}

// ---- Analysis ----
async function startAnalysis() {
  if (!state.apiKey) { alert('Please save your OpenAI API key first.'); return; }
  if (!state.mode) { alert('Please select Employer or Contractor mode.'); return; }
  if (!state.contractText) { alert('Please upload a contract PDF first.'); return; }

  state.results = [];
  showScreen('progress');
  populateProgressList();

  const contractSample = state.contractText.substring(0, 12000);

  for (let i = 0; i < state.rules.length; i++) {
    const rule = state.rules[i];
    updateProgressBar(i, state.rules.length);
    updateCurrentRule(rule, i);

    try {
      const result = await analyseRule(rule, contractSample);
      state.results.push(result);
      updateRuleProgressItem(i, result);
    } catch (e) {
      state.results.push({
        id: rule.id,
        title: rule.title,
        weight: rule.weight,
        category: rule.category,
        status: 'error',
        score: 0,
        summary: 'Analysis error — please retry.',
        red_flags: [],
        corrective_action: rule.corrective_language,
        financial_exposure: rule.financial_exposure
      });
      updateRuleProgressItem(i, state.results[state.results.length - 1]);
    }

    await sleep(600);
  }

  updateProgressBar(state.rules.length, state.rules.length);
  await sleep(800);
  buildReport();
  showScreen('report');
}

async function analyseRule(rule, contractText) {
  const focus = state.mode === 'employer'
    ? rule.employer_focus
    : rule.contractor_focus;

  const redFlags = state.mode === 'employer'
    ? rule.red_flags_employer
    : rule.red_flags_contractor;

  const prompt = `You are a senior FIDIC contract expert specialising in GCC construction projects.

CONTRACT TEXT (extract):
"""
${contractText}
"""

EVALUATION TASK:
Evaluate this contract against the following FIDIC compliance rule.

Rule ID: ${rule.id}
Rule Title: ${rule.title}
FIDIC Clause Reference: ${rule.clause_1999} (1999) / ${rule.clause_2017} (2017)
Evaluation Mode: ${state.mode === 'employer' ? 'EMPLOYER MODE' : 'CONTRACTOR MODE'}
Evaluation Focus: ${focus}

Compliance Indicators to check:
${rule.compliance_indicators.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Red Flags to watch for (${state.mode} perspective):
${redFlags.map((f, i) => `${i + 1}. ${f}`).join('\n')}

RESPOND WITH VALID JSON ONLY. No explanation before or after. Use this exact structure:
{
  "status": "COMPLIANT" or "PARTIAL" or "NON-COMPLIANT" or "MISSING",
  "score": <integer 0-100>,
  "summary": "<2-3 sentence plain English summary of what was found>",
  "what_is_wrong": "<specific explanation of what is wrong or missing — if compliant write 'No issues found'>",
  "what_it_exposes_you_to": "<plain English explanation of the commercial and legal exposure>",
  "red_flags_found": ["<specific text or issue found>", "<another issue>"],
  "corrective_action": "<specific action to take to remedy this gap>",
  "corrective_language": "<exact clause language to insert or amend>"
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'API error');
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid response format');

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    id: rule.id,
    title: rule.title,
    weight: rule.weight,
    category: rule.category,
    clause_1999: rule.clause_1999,
    clause_2017: rule.clause_2017,
    status: parsed.status || 'NON-COMPLIANT',
    score: parseInt(parsed.score) || 0,
    summary: parsed.summary || '',
    what_is_wrong: parsed.what_is_wrong || '',
    what_it_exposes_you_to: parsed.what_it_exposes_you_to || '',
    red_flags_found: parsed.red_flags_found || [],
    corrective_action: parsed.corrective_action || rule.corrective_language,
    corrective_language: parsed.corrective_language || rule.corrective_language,
    financial_exposure: rule.financial_exposure
  };
}

// ---- Progress UI ----
function populateProgressList() {
  const list = document.getElementById('rule-progress-list');
  list.innerHTML = state.rules.map((rule, i) => `
    <div class="rule-progress-item pending" id="rpi-${i}">
      <span class="rule-status-icon">⏳</span>
      <span class="rule-progress-id">${rule.id}</span>
      <span class="rule-progress-title">${rule.title}</span>
      <span class="rule-progress-status">Pending</span>
    </div>
  `).join('');
}

function updateProgressBar(done, total) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('progress-bar-fill').style.width = pct + '%';
  document.getElementById('progress-count').textContent = `${done} of ${total} rules checked`;
}

function updateCurrentRule(rule, index) {
  document.getElementById('current-rule-text').innerHTML =
    `Currently checking: <strong>${rule.id} — ${rule.title}</strong>`;

  const item = document.getElementById(`rpi-${index}`);
  if (item) {
    item.className = 'rule-progress-item analysing';
    item.querySelector('.rule-status-icon').textContent = '🔄';
    item.querySelector('.rule-progress-status').textContent = 'Analysing...';
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function updateRuleProgressItem(index, result) {
  const item = document.getElementById(`rpi-${index}`);
  if (!item) return;

  const statusMap = {
    'COMPLIANT': { cls: 'compliant', icon: '✅', label: 'Compliant' },
    'PARTIAL': { cls: 'partial', icon: '⚠️', label: 'Partial' },
    'NON-COMPLIANT': { cls: 'non-compliant', icon: '❌', label: 'Non-Compliant' },
    'MISSING': { cls: 'missing', icon: '🔴', label: 'Missing' },
    'error': { cls: 'non-compliant', icon: '⚠️', label: 'Error' }
  };

  const s = statusMap[result.status] || statusMap['NON-COMPLIANT'];
  item.className = `rule-progress-item ${s.cls}`;
  item.querySelector('.rule-status-icon').textContent = s.icon;
  item.querySelector('.rule-progress-status').textContent = s.label;
}

// ---- Report Building ----
function buildReport() {
  const { weightedScore, maxScore } = calculateWeightedScore();
  const percentage = Math.round((weightedScore / maxScore) * 100);
  const riskLevel = getRiskLevel(percentage, state.results);
  const criticalGaps = state.results.filter(r =>
    (r.status === 'NON-COMPLIANT' || r.status === 'MISSING') && r.weight >= 4
  );
  const missingClauses = state.results.filter(r => r.status === 'MISSING');

  // Set report meta
  document.getElementById('report-filename').textContent = state.fileName;
  document.getElementById('report-mode').textContent =
    state.mode === 'employer' ? '🏗️ Employer Mode' : '🔨 Contractor Mode';

  // Summary cards
  const scoreCard = document.getElementById('score-card');
  scoreCard.querySelector('.sc-value').textContent = percentage + '%';
  scoreCard.querySelector('.sc-sub').textContent = `${Math.round(weightedScore)} of ${maxScore} weighted points`;
  scoreCard.dataset.tooltip = `Click to see where you lost ${100 - percentage}%`;

  const riskCard = document.getElementById('risk-card');
  riskCard.querySelector('.sc-value').textContent = riskLevel.label;
  riskCard.querySelector('.sc-sub').textContent = riskLevel.sub;
  riskCard.className = `summary-card risk-${riskLevel.class}`;
  riskCard.dataset.tooltip = 'Click to see what is driving this risk level';

  const critCard = document.getElementById('critical-card');
  critCard.querySelector('.sc-value').textContent = criticalGaps.length;
  critCard.querySelector('.sc-sub').textContent = 'High-weight failures';
  critCard.dataset.tooltip = 'Click to see what makes these critical';

  const missCard = document.getElementById('missing-card');
  missCard.querySelector('.sc-value').textContent = missingClauses.length;
  missCard.querySelector('.sc-sub').textContent = 'Clauses not found';
  missCard.dataset.tooltip = 'Click to see which clauses are completely absent';

  // Store computed data for drawers
  state.computed = { percentage, weightedScore, maxScore, riskLevel, criticalGaps, missingClauses };

  // Build clause list
  buildClauseList();
}

function calculateWeightedScore() {
  let weightedScore = 0;
  let maxScore = 0;
  state.results.forEach(r => {
    weightedScore += (r.score / 100) * r.weight;
    maxScore += r.weight;
  });
  return { weightedScore, maxScore };
}

function getRiskLevel(percentage, results) {
  const criticalFails = results.filter(r =>
    (r.status === 'NON-COMPLIANT' || r.status === 'MISSING') && r.weight === 5
  ).length;

  if (criticalFails >= 3 || percentage < 50) return { label: '🔴 HIGH', class: 'high', sub: 'Immediate attention required' };
  if (criticalFails >= 1 || percentage < 75) return { label: '🟠 MEDIUM', class: 'medium', sub: 'Material gaps identified' };
  return { label: '🟢 LOW', class: 'low', sub: 'Minor improvements needed' };
}

function buildClauseList() {
  const sorted = [...state.results].sort((a, b) => a.score - b.score);
  const container = document.getElementById('clause-list');

  container.innerHTML = sorted.map((result, i) => {
    const statusMap = {
      'COMPLIANT': { cls: 'compliant', icon: '✅' },
      'PARTIAL': { cls: 'partial', icon: '⚠️' },
      'NON-COMPLIANT': { cls: 'non-compliant', icon: '❌' },
      'MISSING': { cls: 'missing', icon: '🔴' },
      'error': { cls: 'non-compliant', icon: '⚠️' }
    };
    const s = statusMap[result.status] || statusMap['NON-COMPLIANT'];
    const barColor = s.cls;

    return `
      <div class="clause-row ${s.cls}" id="cr-${i}" onclick="toggleClauseDetail(${i})">
        <div class="clause-row-header">
          <span class="cr-icon">${s.icon}</span>
          <span class="cr-id">${result.id}</span>
          <span class="cr-title">${result.title}</span>
          <span class="cr-score">${result.score}%</span>
          <div class="cr-bar-wrap">
            <div class="cr-bar">
              <div class="cr-bar-fill ${barColor}" style="width:${result.score}%"></div>
            </div>
          </div>
          <span class="cr-chevron">▼</span>
        </div>
        <div class="clause-detail">
          ${buildClauseDetail(result)}
        </div>
      </div>
    `;
  }).join('');
}

function buildClauseDetail(result) {
  const redFlagsHtml = result.red_flags_found && result.red_flags_found.length > 0
    ? result.red_flags_found.map(f => `<div class="red-flag-item">${escapeHtml(f)}</div>`).join('')
    : '<div class="red-flag-item">No specific red flags detected</div>';

  return `
    <div class="cd-section">
      <div class="cd-section-title">FIDIC Reference</div>
      <div class="cd-text">FIDIC Clause ${result.clause_1999} (1999) / ${result.clause_2017} (2017) · Weight: ${result.weight}/5 · Category: ${result.category}</div>
    </div>

    <div class="cd-section">
      <div class="cd-section-title">What Was Found</div>
      <div class="cd-text">${escapeHtml(result.summary)}</div>
    </div>

    ${result.what_is_wrong && result.what_is_wrong !== 'No issues found' ? `
    <div class="cd-section">
      <div class="cd-section-title">What Is Wrong</div>
      <div class="cd-text">${escapeHtml(result.what_is_wrong)}</div>
    </div>` : ''}

    ${result.what_it_exposes_you_to ? `
    <div class="cd-section">
      <div class="cd-section-title">Commercial & Legal Exposure</div>
      <div class="exposure-box">${escapeHtml(result.what_it_exposes_you_to)}</div>
    </div>` : ''}

    <div class="cd-section">
      <div class="cd-section-title">Red Flags Found In Your Contract</div>
      ${redFlagsHtml}
    </div>

    <div class="cd-section">
      <div class="cd-section-title">Financial Exposure</div>
      <div class="exposure-box">${escapeHtml(result.financial_exposure)}</div>
    </div>

    <div class="cd-section">
      <div class="cd-section-title">Corrective Action</div>
      <div class="cd-text">${escapeHtml(result.corrective_action)}</div>
    </div>

    <div class="cd-section">
      <div class="cd-section-title">Recommended Clause Language</div>
      <div class="corrective-box">
        <button class="copy-btn" onclick="copyClause(this, event)">📋 Copy</button>
        ${escapeHtml(result.corrective_language)}
      </div>
    </div>
  `;
}

function toggleClauseDetail(index) {
  const row = document.getElementById(`cr-${index}`);
  row.classList.toggle('expanded');
}

function copyClause(btn, event) {
  event.stopPropagation();
  const box = btn.parentElement;
  const text = box.textContent.replace('📋 Copy', '').trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
}

// ---- Drawers ----
function openDrawer(type) {
  const { percentage, weightedScore, maxScore, riskLevel, criticalGaps, missingClauses } = state.computed;
  const lostPct = 100 - percentage;

  let title = '';
  let content = '';

  if (type === 'score') {
    title = `📊 Where You Lost ${lostPct}%`;
    content = buildScoreDrawer(lostPct);
  } else if (type === 'risk') {
    title = `${riskLevel.label} — What Is Driving This Risk`;
    content = buildRiskDrawer();
  } else if (type === 'critical') {
    title = `🔴 Your ${criticalGaps.length} Critical Gap${criticalGaps.length !== 1 ? 's' : ''} — Explained`;
    content = buildCriticalDrawer(criticalGaps);
  } else if (type === 'missing') {
    title = `🟣 Missing Clause${missingClauses.length !== 1 ? 's' : ''} — What Is Completely Absent`;
    content = buildMissingDrawer(missingClauses);
  }

  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-content').innerHTML = content;
  document.getElementById('drawer-overlay').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
}

function buildScoreDrawer(lostPct) {
  const losers = [...state.results]
    .filter(r => r.score < 100)
    .sort((a, b) => {
      const lossA = (1 - a.score / 100) * a.weight;
      const lossB = (1 - b.score / 100) * b.weight;
      return lossB - lossA;
    })
    .slice(0, 8);

  const { maxScore } = state.computed;
  const totalLossPoints = losers.reduce((sum, r) => sum + (1 - r.score / 100) * r.weight, 0);

  const criticalLosers = losers.filter(r => r.weight >= 5 && r.score < 60);
  const partialLosers = losers.filter(r => r.weight < 5 || r.score >= 60);

  const lossItems = losers.map(r => {
    const pointsLost = ((1 - r.score / 100) * r.weight).toFixed(1);
    const pctLost = Math.round((pointsLost / maxScore) * 100);
    const isCritical = r.weight >= 5 && r.score < 60;
    return `
      <div class="loss-item ${isCritical ? '' : 'partial'}">
        <div class="loss-item-header">
          <span class="loss-item-id">${r.id} — ${r.title}</span>
          <span class="loss-item-points">−${pctLost}%</span>
        </div>
        <div class="loss-item-reason">
          Weight ${r.weight} × Score ${r.score}% = ${(r.score / 100 * r.weight).toFixed(1)} of ${r.weight} possible points<br>
          ${escapeHtml(r.what_is_wrong || r.summary)}
        </div>
      </div>
    `;
  }).join('');

  const fixCritical = criticalLosers.length;
  const scoreAfterFix = Math.min(100, Math.round(state.computed.percentage +
    criticalLosers.reduce((sum, r) => sum + ((1 - r.score / 100) * r.weight / maxScore) * 100, 0)));

  return `
    <div class="drawer-section">
      <div class="drawer-section-title">Your score is ${state.computed.percentage}%. Here is where the ${lostPct}% was lost, ranked by impact.</div>
      ${lossItems}
    </div>
    <div class="score-fix-callout">
      ✅ Fix the ${fixCritical} critical clause${fixCritical !== 1 ? 's' : ''} above and your score rises from ${state.computed.percentage}% to approximately ${scoreAfterFix}%.
      ${partialLosers.length > 0 ? ` To reach 100%, ${partialLosers.length} further partial gap${partialLosers.length !== 1 ? 's' : ''} also require attention.` : ''}
    </div>
  `;
}

function buildRiskDrawer() {
  const failedHigh = state.results.filter(r =>
    (r.status === 'NON-COMPLIANT' || r.status === 'MISSING') && r.weight === 5
  );

  const causeBlocks = failedHigh.map((r, i) => `
    <div class="risk-cause-block">
      <div class="risk-cause-number">Risk Driver ${i + 1}</div>
      <div class="risk-cause-title">${r.id} — ${r.title} (FIDIC Clause ${r.clause_1999})</div>
      <div class="risk-cause-body">${escapeHtml(r.what_is_wrong || r.summary)}</div>
      <div class="risk-cause-result">⚠ Consequence: ${escapeHtml(r.what_it_exposes_you_to || r.financial_exposure)}</div>
    </div>
  `).join('');

  const combinedWarning = failedHigh.length >= 2
    ? `<div class="risk-combined-warning">
        🔴 <strong>Why this combination matters:</strong><br>
        These ${failedHigh.length} failures do not sit in isolation. Together they create a contract where ${
          failedHigh.map(r => r.title.toLowerCase()).join(', ')
        } are all compromised simultaneously. In a GCC project environment, this combination is the profile seen in contracts that generate the most expensive arbitration outcomes.
      </div>`
    : '';

  return `
    <div class="drawer-section">
      <div class="drawer-section-title">Your risk level is not caused by one problem. It is caused by this specific combination of high-weight failures.</div>
      ${causeBlocks}
      ${combinedWarning}
    </div>
  `;
}

function buildCriticalDrawer(criticalGaps) {
  if (criticalGaps.length === 0) {
    return '<div class="drawer-section"><p>No critical gaps identified. Well done.</p></div>';
  }

  const blocks = criticalGaps.map((r, i) => `
    <div class="critical-gap-block">
      <div class="cgb-header">
        <span>Critical Gap ${i + 1} — ${r.id}: ${r.title}</span>
        <span>FIDIC Clause ${r.clause_1999}</span>
      </div>
      <div class="cgb-body">
        <div class="cgb-field">
          <div class="cgb-field-label">What Is Wrong</div>
          <div class="cgb-field-value">${escapeHtml(r.what_is_wrong || r.summary)}</div>
        </div>
        <div class="cgb-field">
          <div class="cgb-field-label">What This Exposes You To</div>
          <div class="cgb-field-value">${escapeHtml(r.what_it_exposes_you_to || r.financial_exposure)}</div>
        </div>
        <div class="cgb-action">
          ✅ What To Do: ${escapeHtml(r.corrective_action)}
        </div>
      </div>
    </div>
  `).join('');

  return `<div class="drawer-section">${blocks}</div>`;
}

function buildMissingDrawer(missingClauses) {
  if (missingClauses.length === 0) {
    return '<div class="drawer-section"><p>No completely missing clauses. All FIDIC provisions are present to some degree.</p></div>';
  }

  const blocks = missingClauses.map((r, i) => `
    <div class="critical-gap-block">
      <div class="cgb-header" style="background: #6a1b9a;">
        <span>Missing Clause ${i + 1} — ${r.id}: ${r.title}</span>
        <span>FIDIC Clause ${r.clause_1999}</span>
      </div>
      <div class="cgb-body">
        <div class="cgb-field">
          <div class="cgb-field-label">Why It Is Critical That This Clause Exists</div>
          <div class="cgb-field-value">${escapeHtml(r.what_is_wrong || 'This clause could not be located in the contract document.')}</div>
        </div>
        <div class="cgb-field">
          <div class="cgb-field-label">Exposure Without This Clause</div>
          <div class="cgb-field-value">${escapeHtml(r.what_it_exposes_you_to || r.financial_exposure)}</div>
        </div>
        <div class="cgb-field">
          <div class="cgb-field-label">Recommended Clause Language To Insert</div>
          <div class="corrective-box" style="position:relative;">
            <button class="copy-btn" onclick="copyClauseText(this, event, \`${escapeJs(r.corrective_language)}\`)">📋 Copy</button>
            ${escapeHtml(r.corrective_language)}
          </div>
        </div>
      </div>
    </div>
  `).join('');

  return `<div class="drawer-section">${blocks}</div>`;
}

function copyClauseText(btn, event, text) {
  event.stopPropagation();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
}

// ---- Utilities ----
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  state.currentScreen = name;
  window.scrollTo(0, 0);
}

function resetToSetup() {
  state.results = [];
  state.contractText = '';
  state.fileName = '';
  resetDropZone();
  showScreen('setup');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/`/g, '\\`').replace(/\$/g, '\\$');
}
