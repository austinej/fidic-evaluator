// ============================================================
// CONTRACT VAULT — Netlify Serverless Function
// File: netlify/functions/evaluate.js
// Purpose: Secure OpenAI API calls — key never exposed to browser
// ============================================================

const https = require('https');

exports.handler = async (event) => {

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  const { contractChunk, rule, mode } = body;

  // Validate inputs
  if (!contractChunk || !rule || !mode) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: contractChunk, rule, mode' })
    };
  }

  if (!['EMPLOYER', 'CONTRACTOR'].includes(mode)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid mode. Use EMPLOYER or CONTRACTOR' })
    };
  }

  // Get API key from Netlify environment variable — NEVER hardcoded
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured. Set OPENAI_API_KEY in Netlify environment variables.' })
    };
  }

  // Build evaluation prompt
  const prompt = buildPrompt(contractChunk, rule, mode);

  // Call OpenAI GPT-4o
  try {
    const aiResponse = await callOpenAI(apiKey, prompt);
    const parsed = JSON.parse(aiResponse);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    console.error('OpenAI call failed:', err.message);
    // Return a safe fallback so the analysis continues
    return {
      statusCode: 200,
      body: JSON.stringify({
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
      })
    };
  }
};

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

// ── Call OpenAI API (native https — no external packages needed) ──
function callOpenAI(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'OpenAI API error'));
          } else {
            const content = parsed.choices?.[0]?.message?.content;
            if (!content) reject(new Error('Empty response from OpenAI'));
            else resolve(content);
          }
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error('OpenAI request timed out'));
    });

    req.write(requestBody);
    req.end();
  });
}
