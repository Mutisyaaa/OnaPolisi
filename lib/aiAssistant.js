const fetch = globalThis.fetch;

/**
 * Ona Polisi Gemini AI Legal Assistant & Case Companion
 * Powered by Google Gemini
 */

const SYSTEM_INSTRUCTION = `You are "Ona AI", the official AI Legal Companion and Case Navigator for Ona Polisi (onapolisi.org) — Kenya's premier civic-tech police accountability and citizen protection platform.

Your mission is to support Kenyan citizens, victims, and complainants who are dealing with police encounters, arbitrary arrests, extortion, or police misconduct, and to help them understand exactly how their reported case is progressing.

CORE PRINCIPLES & VOICE:
1. EMPATHETIC, CLEAR, & OBJECTIVE: Many users may be anxious, frightened, or legally unfamiliar. Speak with calm reassurance, clarity, and dignity. Avoid cold legalese; explain concepts in plain, human language.
2. MULTILINGUAL & CODE-SWITCHING: Fluently understand and respond in English, Kiswahili, or Sheng (e.g. "polisi walinishika", "nilipelekwa seli", "hongo"). Match the language or tone chosen by the citizen.
3. GROUNDED IN KENYAN LAW:
   - Constitution of Kenya 2010 (Article 49 - Rights of Arrested Persons; Article 29 - Freedom from torture & cruel treatment; Article 50 - Fair hearing).
   - Police bail & bond guidelines (Article 49(1)(h) guarantees reasonable bail unless there are compelling reasons).
   - The 24-Hour Rule: Any detained person must be arraigned in court within 24 hours of arrest.
   - Oversight bodies: Independent Policing Oversight Authority (IPOA), Kenya National Commission on Human Rights (KNCHR), and Law Society of Kenya (LSK).
4. CASE CODE INTELLIGENCE:
   - When provided with case data, break down:
     * Current Phase & What it means in practical terms.
     * What the pro-bono LSK advocates or Ona Polisi team are doing right now.
     * What the citizen should expect next (e.g., advocate contact, court date, evidence review).
     * Recommended actions for the citizen (e.g., obtain a P3 form if injured, keep their phone ready, do not pay unauthorized cash without an official government receipt).
5. SAFETY DISCLAIMER:
   - Remind users that you provide legal information, procedural guidance, and case navigation, but for active emergencies they should dial national lines (999 / 112) or reach IPOA toll-free at 1559.`;

/**
 * Extracts case code from a text string (e.g., "OP-2026-778899", "2026-778899", or "778899")
 */
function extractCaseCode(text) {
  if (!text || typeof text !== 'string') return null;
  
  // Direct match: OP-YYYY-XXXXXX
  const fullMatch = text.match(/\bOP[-_]?(\d{4})[-_]?(\d{6})\b/i);
  if (fullMatch) {
    return `OP-${fullMatch[1]}-${fullMatch[2]}`.toUpperCase();
  }

  // 6 digit match standalone
  const sixDigitMatch = text.match(/\b(\d{6})\b/);
  if (sixDigitMatch) {
    return sixDigitMatch[1];
  }

  return null;
}

/**
 * Queries case details from the database
 */
async function fetchCaseData(pool, caseCode) {
  if (!pool || !caseCode) return null;

  try {
    let incident = null;

    // First try exact match
    if (caseCode.startsWith('OP-')) {
      const res = await pool.query(
        `SELECT id, case_id, category, location, description, status, created_at, updated_at
         FROM incidents WHERE case_id = $1`,
        [caseCode]
      );
      if (res.rowCount > 0) incident = res.rows[0];
    } else {
      // Try suffix match on 6 digits
      const res = await pool.query(
        `SELECT id, case_id, category, location, description, status, created_at, updated_at
         FROM incidents WHERE case_id LIKE $1 LIMIT 1`,
        [`%${caseCode}`]
      );
      if (res.rowCount > 0) incident = res.rows[0];
    }

    if (!incident) return null;

    // Fetch timeline events
    const eventsRes = await pool.query(
      `SELECT status, title, note, created_at
       FROM case_events
       WHERE incident_id = $1
       ORDER BY created_at ASC`,
      [incident.id]
    );

    // Fetch evidence count
    const evidenceRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM evidence WHERE incident_id = $1`,
      [incident.id]
    );

    // Fetch advocate assignment if any
    const claimsRes = await pool.query(
      `SELECT cc.status, cc.claimed_at, u.email, vr.organization, vr.credential_number
       FROM case_claims cc
       JOIN users u ON cc.lawyer_id = u.id
       LEFT JOIN verification_requests vr ON vr.user_id = u.id AND vr.review_status = 'Approved'
       WHERE cc.incident_id = $1 AND cc.status = 'Active'
       LIMIT 1`,
      [incident.id]
    );

    // Fetch official court hearing briefs
    const briefsRes = await pool.query(
      `SELECT cb.*, vr.organization AS lawyer_org
       FROM court_briefs cb
       LEFT JOIN users u ON cb.lawyer_id = u.id
       LEFT JOIN verification_requests vr ON vr.user_id = u.id AND vr.review_status = 'Approved'
       WHERE cb.incident_id = $1
       ORDER BY cb.created_at DESC`,
      [incident.id]
    );

    return {
      incident,
      events: eventsRes.rows,
      evidenceCount: evidenceRes.rows[0]?.count || 0,
      advocateAssigned: claimsRes.rowCount > 0 ? claimsRes.rows[0] : null,
      courtBriefs: briefsRes.rows
    };
  } catch (err) {
    console.error('[AI Assistant] Database query error:', err.message);
    return null;
  }
}

/**
 * Builds the contextualized prompt for Gemini
 */
function buildPrompt(userMessage, caseData, requestedCode) {
  let contextBlock = '';

  if (caseData) {
    const inc = caseData.incident;
    const events = caseData.events;
    const adv = caseData.advocateAssigned;

    contextBlock = `
=== VERIFIED CASE DATA FROM ONA POLISI DATABASE ===
- Case Reference Number: ${inc.case_id}
- Incident Category: ${inc.category}
- Current Official Status: ${inc.status}
- Reported Location: ${inc.location}
- Date Logged: ${new Date(inc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
- Last Updated: ${new Date(inc.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
- Evidence Items Stored & Hashed: ${caseData.evidenceCount} item(s)
- Legal Representation Status: ${adv ? `Claimed by Verified LSK Advocate (${adv.organization || 'LSK Legal Aid Panel'}) on ${new Date(adv.claimed_at).toLocaleDateString('en-GB')}` : 'Queued in Pro-Bono Advocate Matching Pool'}
- Official Court Hearing Briefs Recorded by Advocate:
${caseData.courtBriefs && caseData.courtBriefs.length > 0 ? caseData.courtBriefs.map(b => `  * [Court: ${b.court_name}] Hearing Type: ${b.hearing_type} (Date: ${new Date(b.created_at).toLocaleDateString('en-GB')})\n    - What Transpired in Court: "${b.proceedings_summary}"\n    - Court Orders / Bail: "${b.court_orders || 'None recorded'}"\n    - Next Court Date: ${b.next_court_date ? new Date(b.next_court_date).toLocaleDateString('en-GB') : 'Not yet specified'}\n    - Direct Instructions for Applicant: "${b.instructions_to_applicant || 'Follow standard legal instructions'}"`).join('\n') : '  * No formal court appearances logged yet.'}
- Timeline Milestones Recorded:
${events.length > 0 ? events.map(e => `  * [${e.status}] ${e.title}: ${e.note} (${new Date(e.created_at).toLocaleDateString('en-GB')})`).join('\n') : '  * Initial report successfully logged and cryptographically sealed.'}
===================================================
`;
  } else if (requestedCode) {
    contextBlock = `
=== CASE SEARCH NOTICE ===
The user asked about case code "${requestedCode}", but this exact code was NOT found in the database.
Advise them gently:
1. Double check the format (e.g. OP-2026-XXXXXX).
2. Ensure there are no typos.
3. If they recently submitted, the reference receipt is on their confirmation page or email.
==========================
`;
  }

  return `${contextBlock}

USER MESSAGE:
"${userMessage}"

Please provide a structured, helpful, and empathetic response. If a case was found, clearly explain its current stage, what that means in practice, and what the next milestones are.`;
}

/**
 * Calls the Google Gemini API
 */
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 1200
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Gemini API Error] Status ${response.status}: ${errorText}`);
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response text generated by Gemini');
  }

  return text;
}

/**
 * Main Controller for AI Assistant
 */
async function handleAiAssistantQuery({ userMessage, caseId, pool }) {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return {
      success: false,
      error: 'Please enter a message or case code.'
    };
  }

  const cleanMessage = userMessage.trim();

  // Try extracting case code from explicit param OR from within message
  let detectedCode = caseId ? extractCaseCode(caseId) : extractCaseCode(cleanMessage);

  // If no code extracted, check if message is purely a 6-digit number or case format
  if (!detectedCode) {
    const directDigits = cleanMessage.replace(/[^0-9]/g, '');
    if (directDigits.length === 6) {
      detectedCode = directDigits;
    }
  }

  // Fetch case data if code found
  let caseData = null;
  if (detectedCode) {
    caseData = await fetchCaseData(pool, detectedCode);
  }

  // Build prompt
  const fullPrompt = buildPrompt(cleanMessage, caseData, detectedCode);

  try {
    const aiAnswer = await callGemini(fullPrompt);
    return {
      success: true,
      answer: aiAnswer,
      caseFound: Boolean(caseData),
      caseSummary: caseData ? {
        case_id: caseData.incident.case_id,
        category: caseData.incident.category,
        status: caseData.incident.status,
        created_at: caseData.incident.created_at,
        evidenceCount: caseData.evidenceCount,
        hasAdvocate: Boolean(caseData.advocateAssigned),
        courtBriefsCount: caseData.courtBriefs ? caseData.courtBriefs.length : 0,
        latestCourtBrief: caseData.courtBriefs && caseData.courtBriefs[0] ? {
          court_name: caseData.courtBriefs[0].court_name,
          hearing_type: caseData.courtBriefs[0].hearing_type,
          next_court_date: caseData.courtBriefs[0].next_court_date,
          created_at: caseData.courtBriefs[0].created_at
        } : null
      } : null
    };
  } catch (err) {
    console.error('[AI Assistant Handler Error]:', err.message);
    return {
      success: false,
      error: 'The AI assistant is temporarily unreachable. Please try again in a few moments.'
    };
  }
}

module.exports = {
  extractCaseCode,
  fetchCaseData,
  handleAiAssistantQuery
};

