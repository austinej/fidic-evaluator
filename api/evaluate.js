// ============================================================
// CONTRACT VAULT — Vercel Serverless Function
// File: api/evaluate.js
// Purpose: Secure OpenAI API calls — key never exposed to browser
// ============================================================

export default async function handler(req, res) {
  // ── CORS Headers ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle browser preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body safely
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  }

  const { contractChunk, rule, mode } = body || {};

  // Validate inputs
  if (!contractChunk || !rule || !mode) {
    return res.status(400).json({
      error: 'Missing required fields: contractChunk, rule, mode'
    });
  }

  if (!['EMPLOYER', 'CONTRACTOR'].includes(mode)) {
    return res.status(400).json({
      error: 'Invalid mode. Use EMPLOYER or CONTRACTOR'
    });
  }

  // Get API key from Vercel environment variable — NEVER hardcoded
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key not configured. Set OPENAI_API_KEY in Vercel environment variables.'
    });
  }

  // Build evaluation prompt
  const prompt = buildPrompt(contractChunk, rule, mode);

  // Call OpenAI
  try {
    const aiResponse = await callOpenAI(apiKey, prompt);
    const parsed = JSON.parse(aiResponse);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('OpenAI call failed:', err.message);

    // Safe fallback so analysis flow can continue
    return res.status(200).json({
      rule_id: rule.rule_id || rule.id,
      fidic_clause_1999: rule.clause_1999 || '',
      fidic_clause_2017: rule.clause_2017 || '',
      title: rule.title,
      category: rule.category || '',
      mode: mode,
      risk_weight: rule.risk_weight || rule.weight || 1,
      status: 'ERROR',
      compliance_score: 0,
      confidence: 'LOW',
      gap_summary: `Analysis failed: ${err.message}`,
      recommendation: 'Please re-run the analysis for this clause.',
      corrective_language: ''
    });
  }
}

// ── Build Evaluation Prompt ──
function buildPrompt(contractChunk, rule, mode) {
  const modeContext = mode === 'EMPLOYER'
    ? {
        label: 'EMPLOYER MODE',
        perspective: 'You are acting as the Employer\'s contracts manager or Engineer.',
        question: 'Does this contract clause comply with FIDIC obligations from the Employer\'s perspective?',
        focus: rule.employer_mode?.focus || 'Assess compliance from the Employer\'s risk perspective.',
        consequence: rule.employer_mode?.gap_consequence || 'Assess the gap consequence for the Employer.'
      }
    : {
        label: 'CONTRACTOR MODE',
        perspective: 'You are acting as the Contractor\'s contracts manager or legal advisor.',
        question: 'Does this Employer draft clause preserve or erode the Contractor\'s rights under FIDIC?',
        focus: rule.contractor_mode?.focus || 'Assess compliance from the Contractor\'s risk perspective.',
        consequence: rule.contractor_mode?.gap_consequence || 'Assess the gap consequence for the Contractor.'
      };

  const signals = (rule.evaluation_signals || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const indicators = (rule.failure_indicators || []).map((f, i) => `${i + 1}. ${f}`).join('\n');

  return `You are a senior FIDIC Red Book contract compliance auditor with 20 years of GCC construction experience.

EVALUATION MODE: ${modeContext.label}
YOUR PERSPECTIVE: ${modeContext.perspective}
CORE QUESTION: ${modeContext.question}

FIDIC RULE BEING CHECKED:
Rule ID: ${rule.rule_id || rule.id}
Clause (1999): ${rule.clause_1999 || '—'}
Clause (2017): ${rule.clause_2017 || '—'}
Title: ${rule.title}
Category: ${rule.category || '—'}
Risk Weight: ${rule.risk_weight || rule.weight || 1} out of 5

FIDIC REQUIREMENT:
"${rule.requirement || 'Evaluate compliance with this FIDIC clause.'}"

EVALUATION SIGNALS (what to look for):
${signals || 'Review the clause for standard FIDIC compliance.'}

FAILURE INDICATORS (what absence looks like):
${indicators || 'Look for missing, vague, or non-compliant language.'}

MODE-SPECIFIC FOCUS:
${modeContext.focus}

GAP CONSEQUENCE IF MISSING:
${modeContext.consequence}

CONTRACT TEXT TO EVALUATE:
"""
${contractChunk}
"""

Return ONLY a valid JSON object — no markdown, no commentary:
{
  "rule_id": "${rule.rule_id || rule.id}",
  "fidic_clause_1999": "${rule.clause_1999 || ''}",
  "fidic_clause_2017": "${rule.clause_2017 || ''}",
  "title": "${rule.title}",
  "category": "${rule.category || ''}",
  "mode": "${mode}",
  "risk_weight": ${rule.risk_weight || rule.weight || 1},
  "status": "COMPLIANT | PARTIAL | NON-COMPLIANT | MISSING",
  "compliance_score": 0-100,
  "confidence": "HIGH | MEDIUM | LOW",
  "gap_summary": "specific finding in 1-2 sentences",
  "recommendation": "concrete action for the ${mode === 'EMPLOYER' ? 'Employer' : 'Contractor'} in 1-2 sentences",
  "corrective_language": "suggested contract clause amendment or empty string"
}`;
}

// ── Call OpenAI API ──
async function callOpenAI(apiKey, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(25000)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI API error (${response.status})`);
  }

  if (data?.error) {
    throw new Error(data.error.message || 'OpenAI API error');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return content;
}
