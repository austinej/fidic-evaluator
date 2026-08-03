// ============================================================
// CONTRACT VAULT — FIDIC Evaluator | app.js
// Module 01 | Built by: Austine Jarome | Engine: Vercel
// Architecture: Browser PDF extraction → Vercel Function → OpenAI API
// Version: 2.0 — Secure (No API key in browser)
// ============================================================

'use strict';

// ── PDF.js Configuration ──
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── App State ──
const AppState = {
  mode: null,           // 'EMPLOYER' | 'CONTRACTOR'
  overlay: 'NONE',      // 'NONE' | 'SCAI' | 'NEOM' | 'ADCC'
  contractText: '',
  contractFileName: '',
  fidicRules: null,
  results: [],
  complianceScore: 0,
  isAnalysing: false
};

// ── DOM References ──
const dom = {
  // Screens
  screenSetup:    () => document.getElementById('screen-setup'),
  screenProgress: () => document.getElementById('screen-progress'),
  screenReport:   () => document.getElementById('screen-report'),

  // Mode buttons
  btnEmployer:    () => document.getElementById('btn-employer'),
  btnContractor:  () => document.getElementById('btn-contractor'),

  // Overlay buttons
  overlayBtns:    () => document.querySelectorAll('.overlay-btn'),

  // File upload
  dropZone:       () => document.getElementById('drop-zone'),
  fileInput:      () => document.getElementById('file-input'),
  fileStatus:     () => document.getElementById('file-status'),
  fileName:       () => document.getElementById('file-name'),

  // Analyse button
  btnAnalyse:     () => document.getElementById('btn-analyse'),

  // Progress screen
  progressBar:    () => document.getElementById('progress-bar'),
  progressFill:   () => document.getElementById('progress-fill'),
  progressText:   () => document.getElementById('progress-text'),
  progressCount:  () => document.getElementById('progress-count'),
  progressList:   () => document.getElementById('progress-list'),
  currentRule:    () => document.getElementById('current-rule'),

  // Report screen
  reportScore:    () => document.getElementById('report-score'),
  reportScoreLabel: () => document.getElementById('report-score-label'),
  reportMode:     () => document.getElementById('report-mode'),
  reportFile:     () => document.getElementById('report-file'),
  reportDate:     () => document.getElementById('report-date'),
  reportSummary:  () => document.getElementById('report-summary'),
  reportCards:    () => document.getElementById('report-cards'),
  lostPoints:     () => document.getElementById('lost-points'),
  btnNewAnalysis: () => document.getElementById('btn-new-analysis'),
  btnDownloadPDF: () => document.getElementById('btn-download-pdf'),
};

// ── Load FIDIC Rules JSON ──
async function loadFidicRules() {
  try {
    const response = await fetch('./fidic-rules.json');
    if (!response.ok) throw new Error('Could not load fidic-rules.json');
    const data = await response.json();
    AppState.fidicRules = data;
    console.log(`✅ FIDIC Rules loaded: ${data.knowledge_base?.rules?.length || data.rules?.length} rules`);
  } catch (err) {
    console.error('Failed to load FIDIC rules:', err);
    showError('Failed to load FIDIC knowledge base. Please refresh the page.');
  }
}

// ── Mode Selection ──
function selectMode(mode) {
  AppState.mode = mode;
  dom.btnEmployer().classList.toggle('mode-active', mode === 'EMPLOYER');
  dom.btnContractor().classList.toggle('mode-active', mode === 'CONTRACTOR');
  checkReadyState();
}

// ── Overlay Selection ──
function selectOverlay(overlay) {
  AppState.overlay = overlay;
  dom.overlayBtns().forEach(btn => {
    btn.classList.toggle('overlay-active', btn.dataset.overlay === overlay);
  });
}

// ── Check if Analyse button should be enabled ──
function checkReadyState() {
  const ready = AppState.mode && AppState.contractText;
  const btn = dom.btnAnalyse();
  btn.disabled = !ready;
  btn.style.opacity = ready ? '1' : '0.45';
  btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}

// ── PDF Text Extraction ──
async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }
        if (!fullText.trim()) {
          reject(new Error('No readable text found. This may be a scanned PDF. Please use a text-based PDF.'));
        } else {
          resolve(fullText);
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ── File Handling ──
function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf') {
    showFileError('Please upload a PDF file only.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showFileError('File too large. Maximum size is 20MB.');
    return;
  }

  dom.fileStatus().innerHTML = `<span class="file-loading">⏳ Reading PDF...</span>`;

  extractTextFromPDF(file)
    .then(text => {
      AppState.contractText = text;
      AppState.contractFileName = file.name;
      dom.fileStatus().innerHTML = `
        <span class="file-success">✅ Contract loaded</span>
        <span id="file-name" class="file-name">${file.name} — ${Math.round(text.length / 1000)}k characters extracted</span>
      `;
      checkReadyState();
    })
    .catch(err => {
      showFileError('❌ ' + err.message);
      AppState.contractText = '';
      checkReadyState();
    });
}

function showFileError(msg) {
  dom.fileStatus().innerHTML = `<span class="file-error">${msg}</span>`;
}

// ── Drag & Drop Setup ──
function initDropZone() {
  const zone = dom.dropZone();
  const input = dom.fileInput();

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => handleFile(e.target.files[0]));

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}

// ── Call Netlify Serverless Function ──
async function callEvaluateFunction(contractChunk, rule, mode) {
  const response = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractChunk,
      rule,
      mode
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server error: ${response.status}`);
  }

  return response.json();
}

// ── Extract relevant contract chunk for a rule ──
function extractRelevantChunk(contractText, rule) {
  // Build search keywords from rule signals
  const keywords = [
    rule.title,
    `clause ${rule.clause_1999}`,
    `sub-clause ${rule.clause_1999}`,
    rule.category,
    ...(rule.evaluation_signals || []).slice(0, 3)
  ].filter(Boolean);

  // Split text into paragraphs
  const paragraphs = contractText.split(/\n+/).filter(p => p.trim().length > 20);
  const scored = paragraphs.map(para => {
    let score = 0;
    const lowerPara = para.toLowerCase();
    keywords.forEach(kw => {
      if (lowerPara.includes(kw.toLowerCase())) score++;
    });
    return { para, score };
  });

  // Take top 8 most relevant paragraphs
  const top = scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(p => p.para);

  // If nothing found, send first 3000 chars as context
  if (top.length === 0) {
    return contractText.substring(0, 3000);
  }

  return top.join('\n\n').substring(0, 4000);
}

// ── Calculate Compliance Score ──
function calculateScore(results, rules) {
  let totalWeight = 0;
  let earnedWeight = 0;

  results.forEach((result, idx) => {
    const rule = rules[idx];
    if (!rule) return;
    const weight = rule.risk_weight || rule.weight || 1;
    totalWeight += weight;

    const score = result.compliance_score || 0;
    earnedWeight += (score / 100) * weight;
  });

  return totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
}

// ── Run Analysis ──
async function runAnalysis() {
  if (AppState.isAnalysing) return;
  AppState.isAnalysing = true;

  // Validate
  if (!AppState.mode) { alert('Please select Employer or Contractor mode.'); AppState.isAnalysing = false; return; }
  if (!AppState.contractText) { alert('Please upload a contract PDF.'); AppState.isAnalysing = false; return; }
  if (!AppState.fidicRules) { alert('FIDIC rules not loaded. Please refresh.'); AppState.isAnalysing = false; return; }

  // Get rules array (handle both JSON structures)
  const rules = AppState.fidicRules.knowledge_base?.rules || AppState.fidicRules.rules || [];
  if (rules.length === 0) { alert('No FIDIC rules found in knowledge base.'); AppState.isAnalysing = false; return; }

  // Switch to progress screen
  showScreen('progress');
  AppState.results = [];

  const progressList = dom.progressList();
  progressList.innerHTML = '';

  // Pre-populate list items
  rules.forEach(rule => {
    const li = document.createElement('li');
    li.id = `rule-item-${rule.rule_id || rule.id}`;
    li.className = 'progress-rule-item pending';
    li.innerHTML = `
      <span class="rule-status-icon">⏳</span>
      <span class="rule-id">${rule.rule_id || rule.id}</span>
      <span class="rule-title">${rule.title}</span>
      <span class="rule-result">—</span>
    `;
    progressList.appendChild(li);
  });

  // Process each rule
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ruleId = rule.rule_id || rule.id;

    // Update progress UI
    const pct = Math.round(((i) / rules.length) * 100);
    dom.progressFill().style.width = `${pct}%`;
    dom.progressText().textContent = `${pct}%`;
    dom.progressCount().textContent = `${i} of ${rules.length} rules checked`;
    dom.currentRule().textContent = `${ruleId} — ${rule.title}`;

    // Mark item as active
    const listItem = document.getElementById(`rule-item-${ruleId}`);
    if (listItem) {
      listItem.className = 'progress-rule-item active';
      listItem.querySelector('.rule-status-icon').textContent = '🔄';
      listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    try {
      const chunk = extractRelevantChunk(AppState.contractText, rule);
      const result = await callEvaluateFunction(chunk, rule, AppState.mode);

      AppState.results.push(result);

      // Update list item with result
      if (listItem) {
        const status = result.status || 'UNKNOWN';
        const icons = { COMPLIANT: '✅', PARTIAL: '⚠️', 'NON-COMPLIANT': '❌', MISSING: '🔴', UNKNOWN: '❓' };
        const classes = { COMPLIANT: 'compliant', PARTIAL: 'partial', 'NON-COMPLIANT': 'non-compliant', MISSING: 'missing', UNKNOWN: 'unknown' };
        listItem.className = `progress-rule-item done ${classes[status] || ''}`;
        listItem.querySelector('.rule-status-icon').textContent = icons[status] || '❓';
        listItem.querySelector('.rule-result').textContent = status;
      }

    } catch (err) {
      console.error(`Error on rule ${ruleId}:`, err);
      AppState.results.push({
        rule_id: ruleId,
        title: rule.title,
        status: 'ERROR',
        compliance_score: 0,
        gap_summary: `Analysis failed: ${err.message}`,
        recommendation: 'Please retry this evaluation.',
        risk_weight: rule.risk_weight || rule.weight || 1
      });
      if (listItem) {
        listItem.className = 'progress-rule-item done error';
        listItem.querySelector('.rule-status-icon').textContent = '⚠️';
        listItem.querySelector('.rule-result').textContent = 'ERROR';
      }
    }

    // Small pause between calls
    await new Promise(r => setTimeout(r, 300));
  }

  // Final progress update
  dom.progressFill().style.width = '100%';
  dom.progressText().textContent = '100%';
  dom.progressCount().textContent = `${rules.length} of ${rules.length} rules checked`;
  dom.currentRule().textContent = 'Analysis complete — building your report...';

  await new Promise(r => setTimeout(r, 800));

  // Build and show report
  AppState.complianceScore = calculateScore(AppState.results, rules);
  buildReport(AppState.results, rules);
  showScreen('report');
  AppState.isAnalysing = false;
}

// ── Build Report ──
function buildReport(results, rules) {
  const score = AppState.complianceScore;
  const mode = AppState.mode;

  // Score display
  dom.reportScore().textContent = `${score}%`;
  dom.reportScoreLabel().textContent = getScoreLabel(score);
  dom.reportScore().style.color = getScoreColor(score);

  // Meta
  dom.reportMode().textContent = mode === 'EMPLOYER' ? '🏗️ Employer Mode' : '🔨 Contractor Mode';
  dom.reportFile().textContent = AppState.contractFileName;
  dom.reportDate().textContent = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Executive summary
  const critical = results.filter(r => r.status === 'MISSING' || r.status === 'NON-COMPLIANT');
  const partial = results.filter(r => r.status === 'PARTIAL');
  const compliant = results.filter(r => r.status === 'COMPLIANT');

  dom.reportSummary().innerHTML = `
    <p>This contract scored <strong>${score}%</strong> compliance against the FIDIC Red Book 1999/2017 standard under <strong>${mode === 'EMPLOYER' ? 'Employer' : 'Contractor'} Mode</strong>.</p>
    <p style="margin-top:0.5rem;">
      <strong style="color:#00D4AA">${compliant.length} clauses fully compliant</strong> &nbsp;|&nbsp;
      <strong style="color:#FFD700">${partial.length} partially compliant</strong> &nbsp;|&nbsp;
      <strong style="color:#FF4B4B">${critical.length} critical gaps</strong>
    </p>
    <p style="margin-top:0.5rem;">${generateSummaryText(score, critical, partial, mode)}</p>
  `;

  // Result cards
  const cardsContainer = dom.reportCards();
  cardsContainer.innerHTML = '';
  results.forEach((result, idx) => {
    const rule = rules[idx] || {};
    cardsContainer.appendChild(buildResultCard(result, rule));
  });

  // Lost points breakdown
  buildLostPoints(results, rules);
}

function generateSummaryText(score, critical, partial, mode) {
  if (score >= 90) return `Excellent contract compliance. Minor refinements recommended. ${mode === 'CONTRACTOR' ? 'Your rights are broadly protected under FIDIC.' : 'Contractor obligations are well-defined.'}`;
  if (score >= 75) return `Good baseline compliance with ${critical.length} critical gap${critical.length !== 1 ? 's' : ''} requiring immediate attention before contract execution.`;
  if (score >= 60) return `Moderate compliance. ${critical.length} critical clause${critical.length !== 1 ? 's are' : ' is'} missing or non-compliant — significant risk exposure if executed as-is.`;
  if (score >= 40) return `Significant compliance deficiencies identified. This contract carries substantial legal and commercial risk. Amendment is strongly recommended before signing.`;
  return `Critical compliance failure. This contract deviates materially from FIDIC Red Book standards. Do not execute without comprehensive legal review.`;
}

function getScoreLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Moderate';
  if (score >= 40) return 'Poor';
  return 'Critical';
}

function getScoreColor(score) {
  if (score >= 90) return '#00D4AA';
  if (score >= 75) return '#FFD700';
  if (score >= 60) return '#FF8C00';
  return '#FF4B4B';
}

function buildResultCard(result, rule) {
  const statusConfig = {
    COMPLIANT:      { icon: '✅', cls: 'card-compliant',     label: 'Compliant' },
    PARTIAL:        { icon: '⚠️', cls: 'card-partial',       label: 'Partial' },
    'NON-COMPLIANT':{ icon: '❌', cls: 'card-noncompliant',  label: 'Non-Compliant' },
    MISSING:        { icon: '🔴', cls: 'card-missing',       label: 'Missing' },
    ERROR:          { icon: '⚠️', cls: 'card-error',         label: 'Error' }
  };

  const status = result.status || 'UNKNOWN';
  const cfg = statusConfig[status] || { icon: '❓', cls: '', label: status };
  const weight = result.risk_weight || rule.risk_weight || rule.weight || 1;
  const score = result.compliance_score || 0;
  const clause = result.fidic_clause_1999 || rule.clause_1999 || rule.clause_ref || '—';

  const card = document.createElement('div');
  card.className = `result-card ${cfg.cls}`;
  card.innerHTML = `
    <div class="card-header">
      <div class="card-header-left">
        <span class="card-status-icon">${cfg.icon}</span>
        <div>
          <div class="card-rule-id">${result.rule_id || rule.rule_id || rule.id}</div>
          <div class="card-title">${result.title || rule.title}</div>
        </div>
      </div>
      <div class="card-header-right">
        <div class="card-score-circle" style="border-color:${getScoreColor(score)};color:${getScoreColor(score)}">${score}%</div>
        <div class="card-meta-tags">
          <span class="tag-clause">Clause ${clause}</span>
          <span class="tag-weight">Weight: ${weight}/5</span>
          ${result.confidence ? `<span class="tag-confidence">AI: ${result.confidence}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="card-body">
      ${result.gap_summary ? `
        <div class="card-section">
          <div class="card-section-label">⚡ Gap Analysis</div>
          <p>${result.gap_summary}</p>
        </div>` : ''}
      ${result.recommendation ? `
        <div class="card-section">
          <div class="card-section-label">🛡️ Recommendation</div>
          <p>${result.recommendation}</p>
        </div>` : ''}
      ${result.corrective_language ? `
        <div class="card-section">
          <div class="card-section-label">📝 Suggested Clause Language</div>
          <div class="corrective-language">${result.corrective_language}</div>
        </div>` : ''}
    </div>
  `;

  // Collapsible toggle
  const header = card.querySelector('.card-header');
  const body = card.querySelector('.card-body');
  body.style.display = (status === 'COMPLIANT') ? 'none' : 'block';
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });

  return card;
}

function buildLostPoints(results, rules) {
  const lostContainer = dom.lostPoints();
  const gaps = results
    .map((r, i) => {
      const rule = rules[i] || {};
      const weight = r.risk_weight || rule.risk_weight || rule.weight || 1;
      const maxPoints = weight;
      const earnedPoints = ((r.compliance_score || 0) / 100) * weight;
      const lostPts = +(maxPoints - earnedPoints).toFixed(2);
      return { ...r, lostPts, maxPoints };
    })
    .filter(r => r.lostPts > 0)
    .sort((a, b) => b.lostPts - a.lostPts);

  if (gaps.length === 0) {
    lostContainer.innerHTML = '<p style="color:#00D4AA;text-align:center;padding:1rem;">🎉 No points lost — perfect compliance!</p>';
    return;
  }

  lostContainer.innerHTML = `
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem;">
      Your weighted compliance score is <strong style="color:var(--gold)">${AppState.complianceScore}%</strong>.
      Here is exactly where points were lost, ranked by impact.
    </p>
    <div class="lost-points-list">
      ${gaps.map(g => `
        <div class="lost-item">
          <span class="lost-rule-id">${g.rule_id}</span>
          <span class="lost-title">${g.title}</span>
          <span class="lost-pts" style="color:${getScoreColor(100 - (g.lostPts / g.maxPoints) * 100)}">
            −${g.lostPts.toFixed(1)} pts
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── PDF Download ──
function downloadReport() {
  // Build printable HTML and open in new window for browser print-to-PDF
  const score = AppState.complianceScore;
  const mode = AppState.mode;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const resultsHTML = AppState.results.map(r => {
    const statusColors = { COMPLIANT: '#00D4AA', PARTIAL: '#FFD700', 'NON-COMPLIANT': '#FF4B4B', MISSING: '#FF4B4B' };
    const color = statusColors[r.status] || '#8892B0';
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #1C2540;font-weight:600">${r.rule_id}</td>
        <td style="padding:8px;border-bottom:1px solid #1C2540">${r.title}</td>
        <td style="padding:8px;border-bottom:1px solid #1C2540;color:${color};font-weight:700">${r.status}</td>
        <td style="padding:8px;border-bottom:1px solid #1C2540;color:${color}">${r.compliance_score}%</td>
        <td style="padding:8px;border-bottom:1px solid #1C2540;font-size:0.85rem">${r.gap_summary || '—'}</td>
      </tr>
    `;
  }).join('');

  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>ContractVault FIDIC Report — ${AppState.contractFileName}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet"/>
      <style>
        body { font-family: 'Inter', sans-serif; background: #fff; color: #0A0F1E; margin: 0; padding: 40px; }
        .cv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:20px; border-bottom:3px solid #FFD700; }
        .cv-logo { font-family:'Playfair Display',serif; font-size:28px; font-weight:800; color:#0A0F1E; }
        .cv-logo span { color:#1E6FFF; }
        .report-title { font-size:22px; font-weight:700; margin:0 0 8px; }
        .score-box { font-size:64px; font-weight:800; color:${getScoreColor(score)}; }
        .meta-row { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px; }
        .meta-item { background:#F5F7FF; border-radius:8px; padding:12px 16px; }
        .meta-label { font-size:11px; color:#8892B0; text-transform:uppercase; letter-spacing:1px; }
        .meta-value { font-weight:700; font-size:14px; margin-top:4px; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th { background:#0A0F1E; color:#FFD700; padding:10px 8px; text-align:left; font-weight:600; }
        .footer { margin-top:40px; padding-top:20px; border-top:1px solid #ddd; font-size:11px; color:#8892B0; display:flex; justify-content:space-between; }
      </style>
    </head>
    <body>
      <div class="cv-header">
        <div>
          <div class="cv-logo">Contract<span>Vault</span></div>
          <div style="font-size:12px;color:#8892B0;margin-top:4px">Module 01 — FIDIC Contracts Evaluator</div>
        </div>
        <div style="text-align:right">
          <div class="score-box">${score}%</div>
          <div style="font-size:14px;color:#8892B0">${getScoreLabel(score)} Compliance</div>
        </div>
      </div>

      <div class="meta-row">
        <div class="meta-item">
          <div class="meta-label">Contract File</div>
          <div class="meta-value">${AppState.contractFileName}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Evaluation Mode</div>
          <div class="meta-value">${mode === 'EMPLOYER' ? 'Employer Mode' : 'Contractor Mode'}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Report Date</div>
          <div class="meta-value">${date}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Standard</div>
          <div class="meta-value">FIDIC Red Book 1999 / 2017</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Rules Evaluated</div>
          <div class="meta-value">${AppState.results.length} of 20</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Powered By</div>
          <div class="meta-value">ContractVault AI Engine</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Rule ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Score</th>
            <th>Gap Summary</th>
          </tr>
        </thead>
        <tbody>${resultsHTML}</tbody>
      </table>

      <div class="footer">
        <span>© 2026 Austine Jarome — ContractVault Platform. All rights reserved.</span>
        <span>Generated: ${new Date().toISOString()}</span>
      </div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(printContent);
  win.document.close();
  setTimeout(() => win.print(), 800);
}

// ── Screen Navigation ──
function showScreen(name) {
  ['setup', 'progress', 'report'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.style.display = s === name ? 'block' : 'none';
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetToSetup() {
  AppState.mode = null;
  AppState.contractText = '';
  AppState.contractFileName = '';
  AppState.results = [];
  AppState.complianceScore = 0;
  AppState.isAnalysing = false;

  dom.btnEmployer().classList.remove('mode-active');
  dom.btnContractor().classList.remove('mode-active');
  dom.fileStatus().innerHTML = '';
  dom.overlayBtns().forEach(btn => {
    btn.classList.toggle('overlay-active', btn.dataset.overlay === 'NONE');
  });
  AppState.overlay = 'NONE';

  checkReadyState();
  showScreen('setup');
}

function showError(msg) {
  alert(msg);
}

// ── Initialise App ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load FIDIC rules
  await loadFidicRules();

  // Init drop zone
  initDropZone();

  // Mode buttons
  dom.btnEmployer()?.addEventListener('click', () => selectMode('EMPLOYER'));
  dom.btnContractor()?.addEventListener('click', () => selectMode('CONTRACTOR'));

  // Overlay buttons
  dom.overlayBtns().forEach(btn => {
    btn.addEventListener('click', () => selectOverlay(btn.dataset.overlay));
  });

  // Analyse button
  dom.btnAnalyse()?.addEventListener('click', runAnalysis);

  // Report actions
  dom.btnNewAnalysis()?.addEventListener('click', resetToSetup);
  dom.btnDownloadPDF()?.addEventListener('click', downloadReport);

  // Set default overlay
  selectOverlay('NONE');

  // Initial state check
  checkReadyState();

  console.log('✅ ContractVault FIDIC Evaluator v2.0 initialised');
});
