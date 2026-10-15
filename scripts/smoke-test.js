require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const adminEmail = process.env.ADMIN_EMAIL || 'k3v1n.goof@gmail.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'password';
const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

class CookieJar {
  constructor() { this.cookie = ''; }
  update(response) {
    const header = response.headers.get('set-cookie');
    if (header) this.cookie = header.split(';')[0];
  }
  headers() { return this.cookie ? { Cookie: this.cookie } : {}; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options = {}, jar = new CookieJar()) {
  const headers = { ...(options.headers || {}), ...jar.headers() };
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  jar.update(response);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, body };
}

async function json(pathname, options, jar) {
  const result = await request(pathname, options, jar);
  if (result.body instanceof ArrayBuffer) return { ...result, body: Buffer.from(result.body).toString('utf8') };
  return result;
}

async function login(email, password) {
  const jar = new CookieJar();
  const result = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, jar);
  assert(result.response.ok, `Login failed for ${email}: ${JSON.stringify(result.body)}`);
  return jar;
}

async function register(email, password) {
  const jar = new CookieJar();
  const result = await json('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, jar);
  assert(result.response.status === 201, `Registration failed for ${email}: ${JSON.stringify(result.body)}`);
  return { jar, user: result.body.user };
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const reporterEmail = `smoke-reporter-${Date.now()}@example.test`;
  const lawyerEmail = `smoke-lawyer-${Date.now()}@example.test`;
  const testPassword = 'SmokeTestPassword123!';
  let caseId = null;
  let evidenceId = null;
  let evidenceStoredName = null;
  let reporterId = null;
  let lawyerId = null;

  try {
    const health = await json('/api/health');
    assert(health.response.ok && health.body.ok && health.body.database === 'connected', 'Health check failed.');

    const reporter = await register(reporterEmail, testPassword);
    reporterId = reporter.user.id;
    const lawyer = await register(lawyerEmail, testPassword);
    lawyerId = lawyer.user.id;
    await pool.query("UPDATE users SET role = 'lawyer', verification_status = 'verified' WHERE id = $1", [lawyerId]);

    const created = await json('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'Use of excessive force',
        location: 'Smoke test station',
        description: 'A smoke-test report used to verify the protected workflow.',
        confidential_contact: 'smoke-contact@example.test',
        confidential_contact_consent: true,
      }),
    }, reporter.jar);
    assert(created.response.status === 201, `Report creation failed: ${JSON.stringify(created.body)}`);
    caseId = created.body.incident.case_id;

    const privateCase = await json(`/api/incidents/${caseId}`, {}, reporter.jar);
    assert(privateCase.response.ok && privateCase.body.incident.description, 'Reporter could not view the private case details.');
    assert(privateCase.body.incident.status === 'Filed', 'New case did not begin in Filed state.');

    const evidenceForm = new FormData();
    evidenceForm.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'smoke-test.png');
    const uploaded = await json(`/api/incidents/${caseId}/evidence`, { method: 'POST', body: evidenceForm }, reporter.jar);
    assert(uploaded.response.status === 201, `Evidence upload failed: ${JSON.stringify(uploaded.body)}`);
    assert(uploaded.body.evidence.security_scan_status === 'Cleared', `ClamAV did not clear the test file: ${JSON.stringify(uploaded.body)}`);
    assert(uploaded.body.evidence.metadata_status === 'Stripped', 'Image metadata was not stripped.');
    assert(uploaded.body.evidence.moderation_status === 'Pending', 'Evidence did not enter moderation.');
    evidenceId = uploaded.body.evidence.id;

    const adminJar = await login(adminEmail, adminPassword);
    const pending = await json('/api/admin/evidence?status=Pending', {}, adminJar);
    const pendingItem = pending.body.evidence.find((item) => item.id === evidenceId);
    assert(pending.response.ok && pendingItem, 'Admin could not find pending evidence.');
    const approved = await json(`/api/admin/evidence/${evidenceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moderation_status: 'Approved' }),
    }, adminJar);
    assert(approved.response.ok && approved.body.evidence.moderation_status === 'Approved', 'Evidence approval failed.');

    const download = await request(`/api/evidence/${evidenceId}/download`, {}, adminJar);
    assert(download.response.ok && Buffer.from(download.body).length > 0, 'Approved evidence could not be downloaded.');

    const moved = await json(`/api/admin/cases/${caseId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Under review', note: 'Smoke-test workflow transition.' }),
    }, adminJar);
    assert(moved.response.ok && moved.body.case.status === 'Under review', 'Case state transition failed.');

    const publicCase = await json(`/api/incidents/${caseId}`);
    assert(publicCase.response.ok && !publicCase.body.incident.description, 'Public case response leaked the description.');
    assert(publicCase.body.incident.location.includes('Withheld'), 'Public case response leaked the exact location.');

    const lawyerJar = lawyer.jar;
    const available = await json('/api/lawyer/available', {}, lawyerJar);
    assert(available.response.ok && available.body.cases.some((item) => item.case_id === caseId), 'Lawyer could not see the available case.');
    const claim = await json(`/api/cases/${caseId}/claim`, { method: 'POST' }, lawyerJar);
    assert(claim.response.status === 201, `Lawyer claim failed: ${JSON.stringify(claim.body)}`);
    const contactRequest = await json(`/api/cases/${caseId}/contact-request`, { method: 'POST' }, lawyerJar);
    assert(contactRequest.response.status === 201, `Contact request failed: ${JSON.stringify(contactRequest.body)}`);

    const reports = await json('/api/my-reports', {}, reporter.jar);
    const report = reports.body.reports.find((item) => item.case_id === caseId);
    const requestRecord = report?.contact_requests?.[0];
    assert(reports.response.ok && requestRecord?.status === 'Pending', 'Reporter could not see the pending contact request.');
    const approvedContact = await json(`/api/my-reports/${caseId}/contact-requests/${requestRecord.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'Approved' }),
    }, reporter.jar);
    assert(approvedContact.response.ok && approvedContact.body.status === 'Approved', 'Reporter contact approval failed.');
    const revealed = await json(`/api/cases/${caseId}/confidential-contact`, {}, lawyerJar);
    assert(revealed.response.ok && revealed.body.contact === 'smoke-contact@example.test', 'Approved contact was not revealed to the claiming lawyer.');

    const timeline = await json(`/api/incidents/${caseId}`, {}, reporter.jar);
    assert(timeline.body.events.some((event) => event.status === 'Under review'), 'Case timeline did not record the state transition.');
    console.log(`Smoke test passed for ${caseId}. Report, evidence, moderation, privacy, lawyer claim, and contact approval are working.`);
  } finally {
    if (caseId) {
      const evidence = await pool.query('SELECT stored_name, storage_backend FROM evidence JOIN incidents ON incidents.id = evidence.incident_id WHERE incidents.case_id = $1', [caseId]);
      evidenceStoredName = evidence.rows.find((item) => item.storage_backend === 'local')?.stored_name || null;
      await pool.query('DELETE FROM incidents WHERE case_id = $1', [caseId]);
    }
    if (reporterId || lawyerId) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [[reporterId, lawyerId].filter(Boolean)]);
    }
    if (evidenceStoredName) await fs.rm(path.join(__dirname, '..', 'data', 'evidence', evidenceStoredName), { force: true });
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
