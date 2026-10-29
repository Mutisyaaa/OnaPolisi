require('dotenv').config();

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const net = require('node:net');
const { promisify } = require('node:util');
const { handleAiAssistantQuery, handleLawyerAiAssist } = require('./lib/aiAssistant');

const app = express();
const port = Number(process.env.PORT || 3000);
const evidenceDirectory = path.join(__dirname, 'data', 'evidence');
const evidenceStorageBackend = process.env.EVIDENCE_STORAGE || 'local';
const s3Bucket = process.env.S3_BUCKET || 'ona-polisi-evidence';
const clamavHost = process.env.CLAMAV_HOST || '';
const clamavPort = Number(process.env.CLAMAV_PORT || 3310);
const s3Client = evidenceStorageBackend === 's3'
  ? new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
        : undefined,
    })
  : null;
fs.mkdirSync(evidenceDirectory, { recursive: true });
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

if (!pool) {
  console.warn('DATABASE_URL is not configured. Add it to .env before using database features.');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname, {
  etag: false,
  maxAge: 0,
  setHeaders: (res, path) => {
    if (path.endsWith('.css') || path.endsWith('.js') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const allowedCategories = new Set([
  'Harassment or intimidation',
  'Extortion or bribery',
  'Unlawful detention',
  'Use of excessive force',
  'Other',
]);

const caseStates = new Set(['Filed', 'Under review', 'Escalated', 'Resolved', 'Ignored', 'Rejected']);
const caseTransitions = new Map([
  ['Filed', new Set(['Under review', 'Rejected'])],
  ['Under review', new Set(['Escalated', 'Resolved', 'Ignored', 'Rejected'])],
  ['Escalated', new Set(['Resolved', 'Ignored', 'Rejected'])],
  ['Resolved', new Set()],
  ['Ignored', new Set()],
  ['Rejected', new Set()],
]);
const allowedEvidenceTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/pdf', '.pdf'],
  ['video/mp4', '.mp4'],
]);
const scryptAsync = promisify(scrypt);
const sessionDurationSeconds = 60 * 60 * 24 * 7;
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, allowedEvidenceTypes.has(file.mimetype)),
});

if (!['local', 's3'].includes(evidenceStorageBackend)) {
  throw new Error('EVIDENCE_STORAGE must be either local or s3.');
}

async function putEvidenceObject(storedName, file) {
  if (evidenceStorageBackend === 's3') {
    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `evidence/${storedName}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { sha256: file.sha256 || '' },
    }));
    return;
  }
  await fsp.writeFile(path.join(evidenceDirectory, storedName), file.buffer, { flag: 'wx' });
}

async function deleteEvidenceObject(storedName) {
  if (evidenceStorageBackend === 's3') {
    await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: `evidence/${storedName}` }));
    return;
  }
  await fsp.unlink(path.join(evidenceDirectory, storedName)).catch(() => {});
}

function hasValidFileSignature(mimetype, buffer) {
  if (mimetype === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimetype === 'video/mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return false;
}

function scanWithClamAV(buffer) {
  if (!clamavHost) return Promise.resolve('Unavailable');
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: clamavHost, port: clamavPort });
    let response = '';
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(15_000, () => finish('Unavailable'));
    socket.on('connect', () => {
      socket.write(Buffer.from([0x7a, 0x49, 0x4e, 0x53, 0x54, 0x52, 0x45, 0x41, 0x4d, 0x00]));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
    socket.on('data', (data) => {
      response += data.toString('utf8');
      if (response.includes('FOUND')) finish('Infected');
      else if (response.includes('OK')) finish('Cleared');
    });
    socket.on('error', () => finish('Unavailable'));
    socket.on('close', () => { if (!settled) finish(response.includes('OK') ? 'Cleared' : 'Unavailable'); });
  });
}

async function stripMetadata(mimetype, buffer) {
  if (mimetype === 'image/jpeg' || mimetype === 'image/png') {
    const cleaned = await sharp(buffer).rotate().toFormat(mimetype === 'image/jpeg' ? 'jpeg' : 'png').toBuffer();
    return { buffer: cleaned, status: 'Stripped' };
  }
  return { buffer, status: 'Unavailable' };
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function getEncryptionKey() {
  const encodedKey = cleanText(process.env.APP_ENCRYPTION_KEY, 200);
  if (!encodedKey) return null;
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

function encryptSensitive(value) {
  const key = getEncryptionKey();
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptSensitive(payload) {
  const key = getEncryptionKey();
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured.');
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = String(payload || '').split(':');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('The encrypted contact record is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64')), decipher.final()]).toString('utf8');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, n, r, p, salt, expectedHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !expectedHex) return false;
  const derivedKey = await scryptAsync(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p) });
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(derivedKey);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `op_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationSeconds}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'op_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [userId, tokenHash],
  );
  return token;
}

async function getAuthenticatedUser(req) {
  if (!pool) return null;
  const token = parseCookies(req.headers.cookie).op_session;
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await pool.query(
    `SELECT users.id, users.email, users.role, users.verification_status
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, verification_status: user.verification_status };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const user = await getAuthenticatedUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in is required.' });
      if (!roles.includes(user.role)) return res.status(403).json({ error: 'This account does not have access to this area.' });
      req.user = user;
      return next();
    } catch (error) {
      console.error('Role check failed:', error.message);
      return res.status(500).json({ error: 'Access could not be checked.' });
    }
  };
}

const requireSignedIn = requireRole('public', 'lawyer', 'admin');

async function canAccessIncident(user, incidentId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const incidentResult = await pool.query('SELECT reporter_id FROM incidents WHERE id = $1', [incidentId]);
  if (!incidentResult.rowCount) return false;
  if (incidentResult.rows[0].reporter_id === user.id) return true;
  if (user.role !== 'lawyer') return false;
  const claimResult = await pool.query(
    `SELECT 1 FROM case_claims WHERE incident_id = $1 AND lawyer_id = $2`,
    [incidentId, user.id],
  );
  return claimResult.rowCount > 0;
}

function createCaseId() {
  return `OP-${new Date().getFullYear()}-${randomInt(100000, 1_000_000)}`;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Index.html'));
});

app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'Report.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'Login.html'));
});

async function requireAdminPage(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/admin'));
    }
    if (user.role === 'lawyer') {
      return res.redirect('/lawyer/available');
    }
    if (user.role !== 'admin') {
      return res.redirect('/');
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error('requireAdminPage check failed:', error.message);
    return res.redirect('/login');
  }
}

app.get('/for-advocates', (req, res) => {
  res.sendFile(path.join(__dirname, 'ForAdvocates.html'));
});

app.get(['/verification', '/advocate/apply', '/advocate/status'], async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (user && user.role === 'lawyer' && user.verification_status === 'verified') {
      return res.redirect('/lawyer/available');
    }
  } catch (_) {}
  res.sendFile(path.join(__dirname, 'Verification.html'));
});

app.use('/admin', requireAdminPage);

app.get(['/admin', '/admin/moderation'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Admin.html'));
});

app.get('/admin/verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'VerificationAdmin.html'));
});

app.get('/lawyer/available', (req, res) => {
  res.sendFile(path.join(__dirname, 'LawyerAvailable.html'));
});

app.get('/lawyer/my-cases', (req, res) => {
  res.sendFile(path.join(__dirname, 'LawyerMyCases.html'));
});

app.get('/my-reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'MyReports.html'));
});

app.get(['/case/:caseId/receipt', '/receipt', '/receipt/:caseId'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Receipt.html'));
});

app.get(['/case', '/case/:caseId'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Case.html'));
});

app.get('/api/health', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ ok: false, database: 'not configured' });
  }

  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'The database is not configured yet.' });

  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });

  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, verification_status)
       VALUES ($1, $2, 'public', 'unverified')
       RETURNING id, email, role, verification_status`,
      [email, passwordHash],
    );
    const user = result.rows[0];
    setSessionCookie(res, await createSession(user.id));
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    console.error('Registration failed:', error.message);
    return res.status(500).json({ error: 'The account could not be created. Please try again.' });
  }
});

app.post('/api/auth/register-advocate', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'The database is not configured yet.' });

  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const credentialNumber = cleanText(req.body?.credential_number, 120);
  const organization = cleanText(req.body?.organization, 180) || null;

  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (credentialNumber.length < 3) return res.status(400).json({ error: 'Enter your valid LSK Roll Number or Admission Reference.' });

  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, verification_status)
       VALUES ($1, $2, 'public', 'pending')
       RETURNING id, email, role, verification_status`,
      [email, passwordHash],
    );
    const user = result.rows[0];

    await pool.query(
      `INSERT INTO verification_requests (user_id, requested_role, credential_type, credential_number, organization)
       VALUES ($1, 'lawyer', 'LSK number', $2, $3)`,
      [user.id, credentialNumber, organization],
    );

    setSessionCookie(res, await createSession(user.id));
    return res.status(201).json({ user: publicUser(user), message: 'Advocate application submitted successfully.' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists. Please sign in instead.' });
    }
    console.error('Advocate registration failed:', error.message);
    return res.status(500).json({ error: 'The advocate application could not be submitted. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'The database is not configured yet.' });

  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, role, verification_status
       FROM users
       WHERE LOWER(email) = $1`,
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    setSessionCookie(res, await createSession(user.id));
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login failed:', error.message);
    return res.status(500).json({ error: 'The account could not be signed in. Please try again.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Session lookup failed:', error.message);
    return res.status(500).json({ error: 'The session could not be checked.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  if (pool) {
    const token = parseCookies(req.headers.cookie).op_session;
    if (token) {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    }
  }
  clearSessionCookie(res);
  return res.status(204).end();
});

app.get('/api/admin/cases', requireRole('admin'), async (req, res) => {
  const requestedStatus = cleanText(req.query.status, 30) || 'All';
  if (requestedStatus !== 'All' && !caseStates.has(requestedStatus)) {
    return res.status(400).json({ error: 'Choose a valid case status.' });
  }

  try {
    const result = await pool.query(
      `SELECT incidents.case_id, incidents.category, incidents.location, incidents.status,
              incidents.created_at, incidents.updated_at,
              CASE WHEN incidents.reporter_id IS NULL THEN 'Anonymous' ELSE 'Account holder' END AS reporter_kind,
              COUNT(evidence.id)::int AS evidence_count
       FROM incidents
       LEFT JOIN evidence ON evidence.incident_id = incidents.id
       WHERE ($1 = 'All' OR incidents.status = $1)
       GROUP BY incidents.id
       ORDER BY incidents.updated_at DESC
       LIMIT 100`,
      [requestedStatus],
    );
    return res.json({ status: requestedStatus, cases: result.rows });
  } catch (error) {
    console.error('Admin case queue failed:', error.message);
    return res.status(500).json({ error: 'The case queue could not be loaded.' });
  }
});

app.patch('/api/admin/cases/:caseId/status', requireRole('admin'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  const nextStatus = cleanText(req.body?.status, 30);
  const note = cleanText(req.body?.note, 500);
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });
  if (!caseStates.has(nextStatus)) return res.status(400).json({ error: 'Choose a valid case status.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT id, status FROM incidents WHERE case_id = $1 FOR UPDATE`,
      [caseId],
    );
    if (!currentResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'We could not find a case with that reference.' });
    }

    const current = currentResult.rows[0];
    if (current.status === nextStatus) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This case is already ${nextStatus}.` });
    }
    if (!caseTransitions.get(current.status)?.has(nextStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `A case cannot move directly from ${current.status} to ${nextStatus}.` });
    }

    await client.query(
      `UPDATE incidents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [nextStatus, current.id],
    );
    await client.query(
      `INSERT INTO case_events (incident_id, status, title, note)
       VALUES ($1, $2, $3, $4)`,
      [current.id, nextStatus, `Case marked ${nextStatus.toLowerCase()}`, note || `An admin moved this case from ${current.status} to ${nextStatus}.`],
    );
    if (['Ignored', 'Rejected'].includes(nextStatus)) {
      await client.query(
        `UPDATE case_claims SET status = 'Released', released_at = NOW()
         WHERE incident_id = $1 AND status = 'Active'`,
        [current.id],
      );
    }
    await client.query('COMMIT');
    return res.json({ case: { case_id: caseId, previous_status: current.status, status: nextStatus } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Case status update failed:', error.message);
    return res.status(500).json({ error: 'The case status could not be updated.' });
  } finally {
    client.release();
  }
});

app.get('/api/admin/evidence', requireRole('admin'), async (req, res) => {
  const requestedStatus = cleanText(req.query.status, 30) || 'Pending';
  const allowedModerationStatuses = new Set(['Pending', 'Approved', 'Rejected', 'Quarantined']);
  if (!allowedModerationStatuses.has(requestedStatus)) {
    return res.status(400).json({ error: 'Choose a valid moderation status.' });
  }

  try {
    const result = await pool.query(
      `SELECT evidence.id, incidents.case_id, evidence.original_name, evidence.mime_type,
              evidence.size_bytes, evidence.sha256, evidence.security_scan_status,
              evidence.metadata_status, evidence.moderation_status, evidence.created_at
       FROM evidence
       JOIN incidents ON incidents.id = evidence.incident_id
       WHERE evidence.moderation_status = $1
       ORDER BY evidence.created_at ASC`,
      [requestedStatus],
    );
    return res.json({ status: requestedStatus, evidence: result.rows });
  } catch (error) {
    console.error('Evidence moderation queue failed:', error.message);
    return res.status(500).json({ error: 'The moderation queue could not be loaded.' });
  }
});

app.patch('/api/admin/evidence/:evidenceId', requireRole('admin'), async (req, res) => {
  const evidenceId = Number(req.params.evidenceId);
  const moderationStatus = cleanText(req.body?.moderation_status, 30);
  const allowedModerationStatuses = new Set(['Approved', 'Rejected', 'Quarantined']);
  if (!Number.isInteger(evidenceId) || evidenceId < 1) return res.status(400).json({ error: 'Enter a valid evidence ID.' });
  if (!allowedModerationStatuses.has(moderationStatus)) return res.status(400).json({ error: 'Choose Approved, Rejected, or Quarantined.' });

  try {
    const current = await pool.query(
      `SELECT security_scan_status, metadata_status FROM evidence WHERE id = $1`,
      [evidenceId],
    );
    if (!current.rowCount) return res.status(404).json({ error: 'Evidence item not found.' });
    const item = current.rows[0];
    const canApproveUnprocessed = process.env.ALLOW_UNSCANNED_EVIDENCE === 'true';
    if (moderationStatus === 'Approved' && !canApproveUnprocessed
      && (item.security_scan_status !== 'Cleared' || item.metadata_status !== 'Stripped')) {
      return res.status(409).json({ error: 'This file cannot be approved until malware scanning and metadata stripping are complete.' });
    }
    const result = await pool.query(
      `UPDATE evidence
       SET moderation_status = $1
       WHERE id = $2
       RETURNING id, incident_id, original_name, security_scan_status, metadata_status, moderation_status, created_at`,
      [moderationStatus, evidenceId],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Evidence item not found.' });

    const evidence = result.rows[0];
    await pool.query(
      `INSERT INTO case_events (incident_id, status, title, note)
       SELECT $3, status, $1, $2
       FROM incidents
       WHERE id = $3`,
      [`Evidence ${moderationStatus.toLowerCase()}`, `A submitted evidence item was marked ${moderationStatus.toLowerCase()} by a moderator.`, evidence.incident_id],
    );
    return res.json({ evidence });
  } catch (error) {
    console.error('Evidence moderation update failed:', error.message);
    return res.status(500).json({ error: 'The evidence status could not be updated.' });
  }
});

app.post('/api/verification/requests', requireSignedIn, async (req, res) => {
  const requestedRole = cleanText(req.body?.requested_role, 30);
  const credentialType = cleanText(req.body?.credential_type, 40);
  const credentialNumber = cleanText(req.body?.credential_number, 120);
  const organization = cleanText(req.body?.organization, 180) || null;
  const expectedCredential = requestedRole === 'lawyer' ? 'LSK number' : '';

  if (requestedRole !== 'lawyer' || credentialType !== expectedCredential) {
    return res.status(400).json({ error: 'Choose a lawyer with an LSK number.' });
  }
  if (credentialNumber.length < 3) return res.status(400).json({ error: 'Enter the credential number or reference.' });

  try {
    const existing = await pool.query(
      `SELECT id FROM verification_requests
       WHERE user_id = $1 AND review_status = 'Pending'`,
      [req.user.id],
    );
    if (existing.rowCount) return res.status(409).json({ error: 'You already have a verification request under review.' });

    const result = await pool.query(
      `INSERT INTO verification_requests (user_id, requested_role, credential_type, credential_number, organization)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, requested_role, credential_type, organization, review_status, created_at`,
      [req.user.id, requestedRole, credentialType, credentialNumber, organization],
    );
    await pool.query("UPDATE users SET verification_status = 'pending' WHERE id = $1", [req.user.id]);
    return res.status(201).json({ request: result.rows[0] });
  } catch (error) {
    console.error('Verification request failed:', error.message);
    return res.status(500).json({ error: 'The verification request could not be submitted.' });
  }
});

app.get('/api/verification/requests/me', requireSignedIn, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, requested_role, credential_type, organization, review_status, review_note, created_at, reviewed_at
       FROM verification_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    console.error('Verification request lookup failed:', error.message);
    return res.status(500).json({ error: 'Your verification requests could not be loaded.' });
  }
});

app.get('/api/admin/verification', requireRole('admin'), async (req, res) => {
  const requestedStatus = cleanText(req.query.status, 30) || 'Pending';
  if (!['All', 'Pending', 'Approved', 'Rejected'].includes(requestedStatus)) {
    return res.status(400).json({ error: 'Choose a valid verification status.' });
  }
  try {
    const result = await pool.query(
      `SELECT verification_requests.id, users.email, verification_requests.requested_role,
              verification_requests.credential_type, verification_requests.credential_number,
              verification_requests.organization, verification_requests.review_status,
              verification_requests.created_at, verification_requests.reviewed_at,
              verification_requests.review_note
       FROM verification_requests
       JOIN users ON users.id = verification_requests.user_id
       WHERE ($1 = 'All' OR verification_requests.review_status = $1)
       ORDER BY verification_requests.created_at DESC`,
      [requestedStatus],
    );
    return res.json({ status: requestedStatus, requests: result.rows });
  } catch (error) {
    console.error('Verification queue failed:', error.message);
    return res.status(500).json({ error: 'The verification queue could not be loaded.' });
  }
});

app.patch('/api/admin/verification/:requestId', requireRole('admin'), async (req, res) => {
  const requestId = Number(req.params.requestId);
  const reviewStatus = cleanText(req.body?.review_status, 30);
  const reviewNote = cleanText(req.body?.review_note, 500) || null;
  if (!Number.isInteger(requestId) || requestId < 1) return res.status(400).json({ error: 'Enter a valid verification request ID.' });
  if (!['Approved', 'Rejected'].includes(reviewStatus)) return res.status(400).json({ error: 'Choose Approved or Rejected.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(
      `SELECT id, user_id, requested_role
       FROM verification_requests
       WHERE id = $1 AND review_status = 'Pending'`,
      [requestId],
    );
    if (!requestResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending verification request not found.' });
    }

    const request = requestResult.rows[0];
    await client.query(
      `UPDATE verification_requests
       SET review_status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4`,
      [reviewStatus, reviewNote, req.user.id, requestId],
    );
    await client.query(
      `UPDATE users
       SET role = CASE WHEN $1 = 'Approved' THEN $2 ELSE role END,
           verification_status = CASE WHEN $1 = 'Approved' THEN 'verified' ELSE 'unverified' END
       WHERE id = $3`,
      [reviewStatus, request.requested_role, request.user_id],
    );
    await client.query('COMMIT');
    return res.json({ request: { id: requestId, review_status: reviewStatus } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Verification review failed:', error.message);
    return res.status(500).json({ error: 'The verification request could not be reviewed.' });
  } finally {
    client.release();
  }
});

app.get('/api/admin/users', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, verification_status, created_at, last_login_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 100`,
    );
    return res.json({ users: result.rows });
  } catch (error) {
    console.error('Admin users lookup failed:', error.message);
    return res.status(500).json({ error: 'Users list could not be loaded.' });
  }
});

app.post('/api/admin/users/manual-verify', requireRole('admin'), async (req, res) => {
  const targetEmail = normalizeEmail(req.body?.email);
  const targetRole = cleanText(req.body?.role, 30);
  if (!targetEmail) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!['lawyer', 'admin', 'public'].includes(targetRole)) {
    return res.status(400).json({ error: 'Select a valid role.' });
  }

  try {
    const userResult = await pool.query('SELECT id, email, role FROM users WHERE LOWER(email) = $1', [targetEmail]);
    if (!userResult.rowCount) return res.status(404).json({ error: 'User with that email was not found.' });

    const user = userResult.rows[0];
    const newStatus = targetRole === 'public' ? 'unverified' : 'verified';
    await pool.query(
      `UPDATE users
       SET role = $1, verification_status = $2
       WHERE id = $3`,
      [targetRole, newStatus, user.id],
    );

    return res.json({ message: `Successfully updated ${user.email} to ${targetRole} (${newStatus}).` });
  } catch (error) {
    console.error('Manual user verification failed:', error.message);
    return res.status(500).json({ error: 'Failed to update user verification.' });
  }
});

app.get('/api/lawyer/available', requireRole('lawyer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT incidents.id,
              incidents.case_id,
              incidents.category,
              incidents.location,
              incidents.description,
              incidents.status,
              incidents.created_at,
              incidents.confidential_contact_status AS contact_status,
              (SELECT COUNT(*)::int FROM evidence WHERE evidence.incident_id = incidents.id) AS evidence_count
       FROM incidents
       LEFT JOIN case_claims ON case_claims.incident_id = incidents.id AND case_claims.status = 'Active'
       WHERE case_claims.id IS NULL
         AND incidents.status IN ('Filed', 'Under review', 'Escalated')
       ORDER BY incidents.created_at ASC
       LIMIT 100`,
    );
    return res.json({ cases: result.rows });
  } catch (error) {
    console.error('Available lawyer cases lookup failed:', error.message);
    return res.status(500).json({ error: 'Available cases could not be loaded.' });
  }
});

app.get('/api/lawyer/my-cases', requireRole('lawyer'), async (req, res) => {
  try {
    const result = await pool.query(
      `WITH lawyer_cases AS (
         SELECT DISTINCT ON (incidents.id)
                incidents.id AS incident_id,
                incidents.case_id,
                incidents.category,
                incidents.location,
                incidents.description,
                incidents.status,
                incidents.created_at,
                incidents.updated_at,
                case_claims.claimed_at,
                case_claims.released_at,
                case_claims.status AS claim_status,
                incidents.confidential_contact_status AS contact_status,
                CASE
                  WHEN incidents.status IN ('Resolved', 'Closed', 'Rejected', 'Ignored') THEN 'previous'
                  WHEN case_claims.status = 'Released' THEN 'previous'
                  ELSE 'active'
                END AS case_category
         FROM case_claims
         JOIN incidents ON incidents.id = case_claims.incident_id
         WHERE case_claims.lawyer_id = $1
         ORDER BY incidents.id, 
                  CASE WHEN case_claims.status = 'Active' THEN 1 ELSE 2 END,
                  case_claims.claimed_at DESC
       )
       SELECT * FROM lawyer_cases
       ORDER BY 
         CASE WHEN case_category = 'active' THEN 1 ELSE 2 END,
         claimed_at DESC`,
      [req.user.id],
    );
    return res.json({ cases: result.rows });
  } catch (error) {
    console.error('Lawyer case list lookup failed:', error.message);
    return res.status(500).json({ error: 'Your cases could not be loaded.' });
  }
});

app.get('/api/my-reports', requireSignedIn, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT incidents.case_id, incidents.category, incidents.location, incidents.description,
              incidents.status, incidents.created_at, incidents.updated_at,
              incidents.confidential_contact_status AS contact_status,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', requests.id,
                  'status', requests.status,
                  'requested_at', requests.requested_at,
                  'responded_at', requests.responded_at
                ) ORDER BY requests.requested_at DESC)
                FROM case_contact_requests requests
                WHERE requests.incident_id = incidents.id
              ), '[]'::json) AS contact_requests
       FROM incidents
       WHERE incidents.reporter_id = $1
       ORDER BY incidents.created_at DESC`,
      [req.user.id],
    );
    return res.json({ reports: result.rows });
  } catch (error) {
    console.error('Reporter case list lookup failed:', error.message);
    return res.status(500).json({ error: 'Your reports could not be loaded.' });
  }
});

app.post('/api/cases/:caseId/contact-request', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const incidentResult = await client.query(
      `SELECT incidents.id, incidents.confidential_contact_ciphertext, incidents.confidential_contact_status
       FROM incidents
       JOIN case_claims ON case_claims.incident_id = incidents.id
         AND case_claims.lawyer_id = $2 AND case_claims.status = 'Active'
       WHERE incidents.case_id = $1
       FOR UPDATE OF incidents`,
      [caseId, req.user.id],
    );
    if (!incidentResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Claim this case before requesting confidential contact.' });
    }
    const incident = incidentResult.rows[0];
    if (!incident.confidential_contact_ciphertext || incident.confidential_contact_status === 'None') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The reporting party did not leave contact details for legal follow-up.' });
    }
    if (incident.confidential_contact_status === 'Requested') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A contact request is already pending.' });
    }
    if (incident.confidential_contact_status === 'Approved') {
      await client.query('ROLLBACK');
      return res.json({ status: 'Approved' });
    }
    await client.query(
      `INSERT INTO case_contact_requests (incident_id, lawyer_id) VALUES ($1, $2)`,
      [incident.id, req.user.id],
    );
    await client.query(
      `UPDATE incidents SET confidential_contact_status = 'Requested', updated_at = NOW() WHERE id = $1`,
      [incident.id],
    );
    await client.query('COMMIT');
    return res.status(201).json({ status: 'Requested' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'A contact request is already pending.' });
    console.error('Confidential contact request failed:', error.message);
    return res.status(500).json({ error: 'The contact request could not be sent.' });
  } finally {
    client.release();
  }
});

app.get('/api/cases/:caseId/confidential-contact', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  try {
    const result = await pool.query(
      `SELECT incidents.id, incidents.confidential_contact_ciphertext
       FROM incidents
       JOIN case_claims ON case_claims.incident_id = incidents.id
         AND case_claims.lawyer_id = $2 AND case_claims.status = 'Active'
       JOIN case_contact_requests requests ON requests.incident_id = incidents.id
         AND requests.lawyer_id = $2 AND requests.status = 'Approved'
       WHERE incidents.case_id = $1
       ORDER BY requests.responded_at DESC NULLS LAST
       LIMIT 1`,
      [caseId, req.user.id],
    );
    if (!result.rowCount) return res.status(403).json({ error: 'The reporting party has not approved contact access.' });
    const contact = decryptSensitive(result.rows[0].confidential_contact_ciphertext);
    await pool.query(
      `INSERT INTO sensitive_access_logs (incident_id, accessor_id, action) VALUES ($1, $2, 'Viewed confidential contact')`,
      [result.rows[0].id, req.user.id],
    );
    return res.json({ contact });
  } catch (error) {
    console.error('Confidential contact lookup failed:', error.message);
    return res.status(500).json({ error: 'The confidential contact could not be revealed.' });
  }
});

app.patch('/api/my-reports/:caseId/contact-requests/:requestId', requireSignedIn, async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  const requestId = Number(req.params.requestId);
  const decision = cleanText(req.body?.decision, 20);
  if (!/^OP-\d{4}-\d{6}$/.test(caseId) || !Number.isSafeInteger(requestId)) return res.status(400).json({ error: 'The contact request reference is invalid.' });
  if (!['Approved', 'Declined'].includes(decision)) return res.status(400).json({ error: 'Choose whether to approve or decline the request.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE case_contact_requests requests
       SET status = $1, responded_at = NOW()
       FROM incidents
       WHERE requests.id = $2 AND requests.incident_id = incidents.id
         AND incidents.case_id = $3 AND incidents.reporter_id = $4 AND requests.status = 'Pending'
       RETURNING requests.incident_id`,
      [decision, requestId, caseId, req.user.id],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That contact request is no longer pending.' });
    }
    await client.query(
      `UPDATE incidents SET confidential_contact_status = $1, updated_at = NOW() WHERE id = $2`,
      [decision, result.rows[0].incident_id],
    );
    await client.query('COMMIT');
    return res.json({ status: decision });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Confidential contact decision failed:', error.message);
    return res.status(500).json({ error: 'The contact request could not be updated.' });
  } finally {
    client.release();
  }
});

app.post('/api/cases/:caseId/claim', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const incidentResult = await client.query(
      `SELECT id, case_id, status
       FROM incidents
       WHERE case_id = $1
       FOR UPDATE`,
      [caseId],
    );
    if (!incidentResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'We could not find a case with that reference.' });
    }
    const incident = incidentResult.rows[0];
    if (!['Filed', 'Under review', 'Escalated'].includes(incident.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This case is not currently available for a lawyer claim.' });
    }

    const claimResult = await client.query(
      `INSERT INTO case_claims (incident_id, lawyer_id)
       VALUES ($1, $2)
       RETURNING id, claimed_at`,
      [incident.id, req.user.id],
    );

    const nextStatus = incident.status === 'Filed' ? 'Under review' : incident.status;
    if (incident.status === 'Filed') {
      await client.query(
        `UPDATE incidents SET status = 'Under review', updated_at = NOW() WHERE id = $1`,
        [incident.id]
      );
    }

    await client.query(
      `INSERT INTO case_events (incident_id, status, title, note)
       VALUES ($1, $2, 'Advocate Assigned & Under Review', 'A verified LSK legal advocate has claimed this case and initiated legal examination.')`,
      [incident.id, nextStatus],
    );
    await client.query('COMMIT');
    return res.status(201).json({ claim: { case_id: incident.case_id, id: claimResult.rows[0].id, claimed_at: claimResult.rows[0].claimed_at, status: nextStatus } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'This case has already been claimed by another lawyer.' });
    console.error('Lawyer case claim failed:', error.message);
    return res.status(500).json({ error: 'The case could not be claimed.' });
  } finally {
    client.release();
  }
});

app.post('/api/cases/:caseId/release', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  try {
    const result = await pool.query(
      `UPDATE case_claims
       SET status = 'Released', released_at = NOW()
       WHERE lawyer_id = $1 AND status = 'Active'
         AND incident_id = (SELECT id FROM incidents WHERE case_id = $2)
       RETURNING incident_id`,
      [req.user.id, caseId],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'You do not have an active claim on this case.' });
    return res.json({ released: true, case_id: caseId });
  } catch (error) {
    console.error('Lawyer case release failed:', error.message);
    return res.status(500).json({ error: 'The case could not be released.' });
  }
});

app.post('/api/lawyer/cases/:caseId/status', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  const nextStatus = cleanText(req.body?.status, 30);
  const userNote = cleanText(req.body?.note, 1000);

  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });
  if (!['Under review', 'Escalated', 'Resolved'].includes(nextStatus)) {
    return res.status(400).json({ error: 'Choose a valid case status (Under review, Escalated, or Resolved).' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimResult = await client.query(
      `SELECT incidents.id, incidents.status
       FROM incidents
       INNER JOIN case_claims ON case_claims.incident_id = incidents.id
       WHERE incidents.case_id = $1 AND case_claims.lawyer_id = $2 AND case_claims.status = 'Active'
       FOR UPDATE`,
      [caseId, req.user.id]
    );

    if (!claimResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You do not have an active claim on this case.' });
    }

    const current = claimResult.rows[0];
    if (current.status === nextStatus) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This case is already marked as ${nextStatus}.` });
    }

    const allowedMap = {
      'Filed': new Set(['Under review', 'Escalated', 'Resolved']),
      'Under review': new Set(['Escalated', 'Resolved']),
      'Escalated': new Set(['Resolved']),
      'Resolved': new Set()
    };

    if (!allowedMap[current.status]?.has(nextStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `A case cannot move directly from ${current.status} to ${nextStatus}.` });
    }

    await client.query(
      `UPDATE incidents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [nextStatus, current.id]
    );

    let defaultTitle = `Case advanced to ${nextStatus}`;
    let defaultNote = `Advocate updated case stage to ${nextStatus}.`;
    if (nextStatus === 'Escalated') {
      defaultTitle = 'Legal escalation initiated';
      defaultNote = userNote || 'Assigned advocate has escalated this incident to oversight bodies and judicial channels.';
    } else if (nextStatus === 'Resolved') {
      defaultTitle = 'Case concluded & resolved';
      defaultNote = userNote || 'Pro-bono legal aid concluded with successful resolution.';
    } else if (nextStatus === 'Under review') {
      defaultTitle = 'Under active legal review';
      defaultNote = userNote || 'Assigned advocate is actively examining evidence and corresponding with the citizen.';
    }

    await client.query(
      `INSERT INTO case_events (incident_id, status, title, note)
       VALUES ($1, $2, $3, $4)`,
      [current.id, nextStatus, defaultTitle, userNote || defaultNote]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, case_id: caseId, previous_status: current.status, status: nextStatus });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Lawyer status progression failed:', error.message);
    return res.status(500).json({ error: 'The case status could not be updated. Please try again.' });
  } finally {
    client.release();
  }
});

app.post('/api/cases/:caseId/court-brief', requireRole('lawyer'), async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  const courtName = cleanText(req.body?.court_name, 180);
  const hearingType = cleanText(req.body?.hearing_type, 100);
  const proceedingsSummary = cleanText(req.body?.proceedings_summary, 5000);
  const presidingMagistrate = cleanText(req.body?.presiding_magistrate, 140);
  const courtOrders = cleanText(req.body?.court_orders, 2000);
  const nextCourtDate = req.body?.next_court_date ? cleanText(req.body.next_court_date, 30) : null;
  const instructionsToApplicant = cleanText(req.body?.instructions_to_applicant, 2000);

  if (!courtName || !hearingType || !proceedingsSummary) {
    return res.status(400).json({ error: 'Court name, hearing type, and proceedings summary are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimResult = await client.query(
      `SELECT incidents.id, incidents.status
       FROM incidents
       INNER JOIN case_claims ON case_claims.incident_id = incidents.id
       WHERE incidents.case_id = $1 AND case_claims.lawyer_id = $2 AND case_claims.status = 'Active'
       FOR UPDATE`,
      [caseId, req.user.id]
    );

    if (!claimResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You do not have an active representation claim on this case.' });
    }

    const incident = claimResult.rows[0];

    const briefInsert = await client.query(
      `INSERT INTO court_briefs 
       (incident_id, lawyer_id, court_name, hearing_type, presiding_magistrate, proceedings_summary, court_orders, next_court_date, instructions_to_applicant)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        incident.id,
        req.user.id,
        courtName,
        hearingType,
        presidingMagistrate || null,
        proceedingsSummary,
        courtOrders || null,
        nextCourtDate || null,
        instructionsToApplicant || null
      ]
    );

    const eventNote = `Hearing at ${courtName}. Proceedings: ${proceedingsSummary}${courtOrders ? ' | Orders: ' + courtOrders : ''}${nextCourtDate ? ' | Next date: ' + nextCourtDate : ''}`;
    await client.query(
      `INSERT INTO case_events (incident_id, status, title, note)
       VALUES ($1, $2, $3, $4)`,
      [incident.id, incident.status, `🏛️ Court Brief: ${hearingType} (${courtName})`, eventNote]
    );

    const chatMsg = `🏛️ **COURT PROCEEDINGS BRIEF — ${hearingType}**\n**Court:** ${courtName}${presidingMagistrate ? '\n**Presiding:** ' + presidingMagistrate : ''}\n\n**What Transpired in Court:**\n${proceedingsSummary}${courtOrders ? '\n\n**Court Orders / Bail Ruling:**\n' + courtOrders : ''}${nextCourtDate ? '\n\n**Next Court Date:** ' + nextCourtDate : ''}${instructionsToApplicant ? '\n\n**Instructions for You:**\n' + instructionsToApplicant : ''}`;
    await client.query(
      `INSERT INTO case_messages (incident_id, sender_id, sender_role, sender_name, message)
       VALUES ($1, $2, 'lawyer', 'Advocate (Court Brief)', $3)`,
      [incident.id, req.user.id, chatMsg]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, brief: briefInsert.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Court brief recording failed:', error.message);
    return res.status(500).json({ error: 'The court brief could not be saved. Please try again.' });
  } finally {
    client.release();
  }
});

app.get('/api/cases/:caseId/messages', async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  try {
    const user = await getAuthenticatedUser(req);
    const incidentResult = await pool.query('SELECT id, reporter_id FROM incidents WHERE case_id = $1', [caseId]);
    if (!incidentResult.rowCount) return res.status(404).json({ error: 'Case not found.' });
    const incident = incidentResult.rows[0];

    const isReporter = user && user.id === incident.reporter_id;
    let isLawyer = false;
    if (user && user.role === 'lawyer') {
      const claimResult = await pool.query(
        `SELECT 1 FROM case_claims WHERE incident_id = $1 AND lawyer_id = $2`,
        [incident.id, user.id]
      );
      isLawyer = claimResult.rowCount > 0;
    }
    const isAdmin = user && user.role === 'admin';

    const messagesResult = await pool.query(
      `SELECT id, sender_role, 
              replace(sender_name, 'Counsel', 'Advocate') AS sender_name, 
              message, created_at,
              CASE
                WHEN $2::bigint IS NOT NULL AND sender_id = $2::bigint THEN true
                ELSE false
              END AS is_mine
       FROM case_messages
       WHERE incident_id = $1
       ORDER BY created_at ASC`,
      [incident.id, user ? user.id : null]
    );

    return res.json({
      case_id: caseId,
      can_chat: Boolean(isReporter || isLawyer || isAdmin || !incident.reporter_id),
      viewer_role: isLawyer ? 'lawyer' : (isAdmin ? 'admin' : 'applicant'),
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error('Case messages lookup failed:', error.message);
    return res.status(500).json({ error: 'Case messages could not be loaded.' });
  }
});

app.post('/api/cases/:caseId/messages', async (req, res) => {
  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) return res.status(400).json({ error: 'Enter a valid case reference.' });

  const rawMessage = cleanText(req.body?.message, 3000);
  if (!rawMessage || rawMessage.length < 1) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  const requestedRole = cleanText(req.body?.sender_role, 20).toLowerCase();

  try {
    const user = await getAuthenticatedUser(req);
    const incidentResult = await pool.query('SELECT id, reporter_id, status FROM incidents WHERE case_id = $1', [caseId]);
    if (!incidentResult.rowCount) return res.status(404).json({ error: 'Case not found.' });
    const incident = incidentResult.rows[0];

    let senderRole = 'applicant';
    let senderName = 'Applicant (Citizen)';

    if (requestedRole === 'applicant') {
      senderRole = 'applicant';
      senderName = (user && user.email) ? `Applicant (${user.email.split('@')[0]})` : 'Applicant (Citizen)';
    } else if (user && user.role === 'lawyer') {
      const claimResult = await pool.query(
        `SELECT 1 FROM case_claims WHERE incident_id = $1 AND lawyer_id = $2 AND status = 'Active'`,
        [incident.id, user.id]
      );
      if (!claimResult.rowCount) {
        return res.status(403).json({ error: 'You must claim this case before sending messages as an advocate.' });
      }
      senderRole = 'lawyer';
      senderName = `Advocate (${user.email.split('@')[0]})`;
    } else if (user && user.role === 'admin') {
      senderRole = 'admin';
      senderName = 'Ona Polisi Legal Oversight';
    } else {
      senderRole = 'applicant';
      senderName = (user && user.email) ? `Applicant (${user.email.split('@')[0]})` : 'Applicant (Citizen)';
    }

    const savedSenderId = (senderRole === 'lawyer' && user) 
      ? user.id 
      : ((user && user.id === incident.reporter_id) ? user.id : null);

    const insertResult = await pool.query(
      `INSERT INTO case_messages (incident_id, sender_id, sender_role, sender_name, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_role, sender_name, message, created_at`,
      [incident.id, savedSenderId, senderRole, senderName, rawMessage]
    );

    const newMsg = insertResult.rows[0];
    newMsg.is_mine = true;

    if (senderRole === 'lawyer') {
      await pool.query(
        `INSERT INTO case_events (incident_id, status, title, note)
         VALUES ($1, $2, 'Advocate message sent', 'A verified legal advocate sent a confidential follow-up message on this case.')`,
        [incident.id, incident.status]
      );
    }

    return res.status(201).json({ message: newMsg });
  } catch (error) {
    console.error('Case message posting failed:', error.message);
    return res.status(500).json({ error: 'Your message could not be sent. Please try again.' });
  }
});

app.get('/api/evidence/:evidenceId/download', requireSignedIn, async (req, res) => {
  const evidenceId = Number(req.params.evidenceId);
  if (!Number.isSafeInteger(evidenceId)) return res.status(400).json({ error: 'The evidence reference is invalid.' });

  try {
    const result = await pool.query(
      `SELECT evidence.id, evidence.original_name, evidence.stored_name, evidence.storage_backend,
              evidence.mime_type, evidence.moderation_status, evidence.incident_id
       FROM evidence
       WHERE evidence.id = $1`,
      [evidenceId],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'We could not find that evidence item.' });
    const evidence = result.rows[0];
    if (!(await canAccessIncident(req.user, evidence.incident_id))) {
      return res.status(403).json({ error: 'You are not authorized to access this evidence.' });
    }
    if (req.user.role !== 'admin' && evidence.moderation_status !== 'Approved') {
      return res.status(403).json({ error: 'This evidence is not available until moderation is complete.' });
    }

    await pool.query(
      `INSERT INTO sensitive_access_logs (incident_id, accessor_id, action) VALUES ($1, $2, $3)`,
      [evidence.incident_id, req.user.id, `Downloaded evidence ${evidence.id}`],
    );
    res.setHeader('Content-Type', evidence.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(evidence.original_name).replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (evidence.storage_backend === 's3') {
      const object = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: `evidence/${evidence.stored_name}` }));
      return object.Body.pipe(res);
    }
    return res.sendFile(path.join(evidenceDirectory, evidence.stored_name));
  } catch (error) {
    console.error('Evidence download failed:', error.message);
    return res.status(500).json({ error: 'The evidence could not be downloaded.' });
  }
});

app.get('/api/incidents/:caseId', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'The database is not configured yet.' });
  }

  const caseId = cleanText(req.params.caseId, 20).toUpperCase();
  if (!/^OP-\d{4}-\d{6}$/.test(caseId)) {
    return res.status(400).json({ error: 'Enter a valid case reference.' });
  }

  try {
    const incidentResult = await pool.query(
      `SELECT id, case_id, category, location, description, reporter_id, status, created_at, updated_at
       FROM incidents
       WHERE case_id = $1`,
      [caseId],
    );

    if (!incidentResult.rowCount) {
      return res.status(404).json({ error: 'We could not find a case with that reference.' });
    }

    const incident = incidentResult.rows[0];
    const user = await getAuthenticatedUser(req);
    let canViewSensitiveDetails = Boolean(user && (user.role === 'admin' || user.id === incident.reporter_id));
    if (user?.role === 'lawyer') {
      const claimResult = await pool.query(
        `SELECT 1 FROM case_claims WHERE incident_id = $1 AND lawyer_id = $2`,
        [incident.id, user.id],
      );
      canViewSensitiveDetails = claimResult.rowCount > 0;
    }
    const publicIncident = canViewSensitiveDetails
      ? incident
      : { ...incident, location: 'Withheld until confidential access is approved.' };
    delete publicIncident.reporter_id;
    if (!canViewSensitiveDetails) delete publicIncident.description;
    const eventsResult = await pool.query(
      `SELECT status, title, note, created_at
       FROM case_events
       WHERE incident_id = $1
       ORDER BY created_at ASC, id ASC`,
      [incident.id],
    );
    const evidenceResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM evidence WHERE incident_id = $1',
      [incident.id],
    );

    const courtBriefsResult = await pool.query(
      `SELECT cb.id, cb.court_name, cb.hearing_type, cb.presiding_magistrate, cb.proceedings_summary,
              cb.court_orders, cb.next_court_date, cb.instructions_to_applicant, cb.created_at,
              vr.organization AS lawyer_org
       FROM court_briefs cb
       LEFT JOIN users u ON cb.lawyer_id = u.id
       LEFT JOIN verification_requests vr ON vr.user_id = u.id AND vr.review_status = 'Approved'
       WHERE cb.incident_id = $1
       ORDER BY cb.created_at DESC`,
      [incident.id]
    );

    return res.json({
      incident: publicIncident,
      events: eventsResult.rows,
      evidence_count: evidenceResult.rows[0].count,
      court_briefs: courtBriefsResult.rows
    });
  } catch (error) {
    console.error('Incident lookup failed:', error.message);
    return res.status(500).json({ error: 'The case could not be loaded. Please try again.' });
  }
});

app.post('/api/incidents/:caseId/evidence', (req, res, next) => {
  evidenceUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) return next(uploadError);
    if (!pool) return res.status(503).json({ error: 'The database is not configured yet.' });

    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in before uploading evidence.' });

    const caseId = cleanText(req.params.caseId, 20).toUpperCase();
    if (!/^OP-\d{4}-\d{6}$/.test(caseId)) {
      return res.status(400).json({ error: 'Enter a valid case reference.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Choose a JPG, PNG, PDF, or MP4 file up to 25 MB.' });
    }

    let incidentResult;
    try {
      incidentResult = await pool.query('SELECT id, reporter_id FROM incidents WHERE case_id = $1', [caseId]);
    } catch (error) {
      console.error('Evidence case lookup failed:', error.message);
      return res.status(500).json({ error: 'The case could not be checked. Please try again.' });
    }
    if (!incidentResult.rowCount) {
      return res.status(404).json({ error: 'We could not find a case with that reference.' });
    }
    if (!(await canAccessIncident(user, incidentResult.rows[0].id))) {
      return res.status(403).json({ error: 'Only the reporter, assigned lawyer, or an admin can upload evidence.' });
    }

    const extension = allowedEvidenceTypes.get(req.file.mimetype);
    const storedName = `${randomUUID()}${extension}`;
    const originalName = path.basename(req.file.originalname).slice(0, 255) || 'evidence';

    if (!hasValidFileSignature(req.file.mimetype, req.file.buffer)) {
      return res.status(400).json({ error: 'The file contents do not match the selected file type.' });
    }

    const securityScanStatus = await scanWithClamAV(req.file.buffer);
    if (securityScanStatus === 'Infected') {
      return res.status(422).json({ error: 'The uploaded file was flagged by the malware scanner.' });
    }

    let processedFile;
    try {
      processedFile = await stripMetadata(req.file.mimetype, req.file.buffer);
    } catch (error) {
      console.error('Evidence metadata stripping failed:', error.message);
      return res.status(422).json({ error: 'The file metadata could not be safely processed.' });
    }
    const sha256 = createHash('sha256').update(processedFile.buffer).digest('hex');

    try {
      await putEvidenceObject(storedName, { ...req.file, buffer: processedFile.buffer, sha256 });
      const result = await pool.query(
        `INSERT INTO evidence (
           incident_id, original_name, stored_name, storage_backend, mime_type, size_bytes, sha256,
           security_scan_status, metadata_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, original_name, mime_type, size_bytes, sha256, security_scan_status, metadata_status, moderation_status, created_at`,
        [incidentResult.rows[0].id, originalName, storedName, evidenceStorageBackend, req.file.mimetype, processedFile.buffer.length, sha256, securityScanStatus, processedFile.status],
      );

      return res.status(201).json({ evidence: result.rows[0] });
    } catch (error) {
      await deleteEvidenceObject(storedName).catch(() => {});
      console.error('Evidence upload failed:', error.message);
      return res.status(500).json({ error: 'The evidence could not be saved. Please try again.' });
    }
  });
});

app.post('/api/incidents', (req, res, next) => {
  evidenceUpload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Attached file exceeds the 25 MB size limit.' });
      }
      return res.status(400).json({ error: 'Evidence file must be a JPG, PNG, PDF, or MP4 file up to 25 MB.' });
    }
    if (!pool) {
      return res.status(503).json({ error: 'The database is not configured yet.' });
    }

    const category = cleanText(req.body?.category, 80);
    const location = cleanText(req.body?.location, 160);
    const description = cleanText(req.body?.description, 5_000);
    const confidentialContact = cleanText(req.body?.confidential_contact, 320);
    const contactConsent = req.body?.confidential_contact_consent === true || req.body?.confidential_contact_consent === 'true' || req.body?.confidential_contact_consent === 'on';

    if (!allowedCategories.has(category)) {
      return res.status(400).json({ error: 'Choose a valid incident category.' });
    }

    if (!location || location.length < 2) {
      return res.status(400).json({ error: 'Enter a location or station.' });
    }

    if (!description || description.length < 10) {
      return res.status(400).json({ error: 'Describe the incident using at least 10 characters.' });
    }

    if (confidentialContact && !contactConsent) {
      return res.status(400).json({ error: 'Confirm consent before sharing contact details with a verified lawyer.' });
    }

    const reporter = await getAuthenticatedUser(req);
    if (confidentialContact && !reporter) {
      return res.status(401).json({ error: 'Sign in before adding contact details. You can still submit the report anonymously.' });
    }

    let encryptedContact = null;
    if (confidentialContact) {
      try {
        encryptedContact = encryptSensitive(confidentialContact);
      } catch (error) {
        console.error('Confidential contact encryption failed:', error.message);
        return res.status(503).json({ error: 'Confidential contact storage is not configured yet.' });
      }
    }

    // Process attached evidence file if provided
    let fileInfo = null;
    if (req.file) {
      if (!hasValidFileSignature(req.file.mimetype, req.file.buffer)) {
        return res.status(400).json({ error: 'The attached file contents do not match the expected format.' });
      }
      const securityScanStatus = await scanWithClamAV(req.file.buffer);
      if (securityScanStatus === 'Infected') {
        return res.status(422).json({ error: 'The attached file was flagged by the malware scanner.' });
      }
      let processedFile;
      try {
        processedFile = await stripMetadata(req.file.mimetype, req.file.buffer);
      } catch (error) {
        console.error('Evidence metadata stripping failed:', error.message);
        return res.status(422).json({ error: 'The file metadata could not be safely processed.' });
      }
      const extension = allowedEvidenceTypes.get(req.file.mimetype);
      const storedName = `${randomUUID()}${extension}`;
      const originalName = path.basename(req.file.originalname).slice(0, 255) || 'evidence';
      const sha256 = createHash('sha256').update(processedFile.buffer).digest('hex');

      fileInfo = {
        storedName,
        originalName,
        mimetype: req.file.mimetype,
        buffer: processedFile.buffer,
        size: processedFile.buffer.length,
        sha256,
        securityScanStatus,
        metadataStatus: processedFile.status,
      };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const caseId = createCaseId();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO incidents (
             case_id, category, location, description, reporter_id,
             confidential_contact_ciphertext, confidential_contact_consent, confidential_contact_status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, case_id, status, created_at`,
          [caseId, category, location, description, reporter?.id || null, encryptedContact, Boolean(encryptedContact), encryptedContact ? 'Available' : 'None'],
        );

        const incident = result.rows[0];
        await client.query(
          `INSERT INTO case_events (incident_id, status, title, note)
           VALUES ($1, $2, $3, $4)`,
          [incident.id, incident.status, 'Report filed', 'Your report has been recorded.'],
        );

        let savedEvidence = null;
        if (fileInfo) {
          await putEvidenceObject(fileInfo.storedName, {
            buffer: fileInfo.buffer,
            mimetype: fileInfo.mimetype,
            sha256: fileInfo.sha256,
          });
          const evResult = await client.query(
            `INSERT INTO evidence (
               incident_id, original_name, stored_name, storage_backend, mime_type, size_bytes, sha256,
               security_scan_status, metadata_status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, original_name, mime_type, size_bytes, sha256, security_scan_status, metadata_status, moderation_status, created_at`,
            [incident.id, fileInfo.originalName, fileInfo.storedName, evidenceStorageBackend, fileInfo.mimetype, fileInfo.size, fileInfo.sha256, fileInfo.securityScanStatus, fileInfo.metadataStatus],
          );
          savedEvidence = evResult.rows[0];
          await client.query(
            `INSERT INTO case_events (incident_id, status, title, note)
             VALUES ($1, $2, 'Evidence uploaded', $3)`,
            [incident.id, incident.status, `Attached 1 supporting file (${fileInfo.originalName}) with the initial report.`],
          );
        }

        await client.query('COMMIT');
        return res.status(201).json({ incident, evidence: savedEvidence });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (fileInfo) {
          await deleteEvidenceObject(fileInfo.storedName).catch(() => {});
        }
        if (error.code === '23505' && attempt < 2) continue;
        console.error('Incident creation failed:', error.message);
        return res.status(500).json({ error: 'The incident could not be saved. Please try again.' });
      } finally {
        client.release();
      }
    }
  });
});

app.post('/api/ai/assistant', async (req, res) => {
  const userMessage = cleanText(req.body?.message, 2000);
  const caseId = cleanText(req.body?.case_id || req.body?.caseId, 40);

  if (!userMessage) {
    return res.status(400).json({ error: 'Please enter a message or case code.' });

app.post('/api/ai/lawyer/assist', requireRole('lawyer'), async (req, res) => {
  const action = cleanText(req.body?.action, 50);
  const caseId = req.body?.caseId ? cleanText(req.body.caseId, 25).toUpperCase() : null;
  const payload = req.body?.payload || {};

  try {
    // If advocate requested to send a message directly on their behalf
    if (action === 'send_reporter_message') {
      if (!caseId) return res.status(400).json({ error: 'Case ID is required to send a message.' });

      const incidentResult = await pool.query('SELECT id, status FROM incidents WHERE case_id = $1', [caseId]);
      if (!incidentResult.rowCount) return res.status(404).json({ error: 'Case not found.' });
      const incident = incidentResult.rows[0];

      const claimResult = await pool.query(
        `SELECT 1 FROM case_claims WHERE incident_id = $1 AND lawyer_id = $2 AND status = 'Active'`,
        [incident.id, req.user.id]
      );
      if (!claimResult.rowCount) {
        return res.status(403).json({ error: 'You must claim this case before sending messages as an advocate.' });
      }

      let messageText = payload.messageText ? cleanText(payload.messageText, 3000) : null;
      if (!messageText) {
        const aiRes = await handleLawyerAiAssist({
          action: 'draft_reporter_message',
          caseId,
          pool,
          user: req.user,
          payload
        });
        if (!aiRes.success) return res.status(500).json({ error: aiRes.error || 'Failed to draft AI message.' });
        messageText = aiRes.draft;
      }

      const insertResult = await pool.query(
        `INSERT INTO case_messages (incident_id, sender_id, sender_role, sender_name, message)
         VALUES ($1, $2, 'lawyer', $3, $4)
         RETURNING id, sender_role, sender_name, message, created_at`,
        [incident.id, req.user.id, `Advocate (${req.user.email.split('@')[0]})`, messageText]
      );

      await pool.query(
        `INSERT INTO case_events (incident_id, status, title, note)
         VALUES ($1, $2, 'Advocate message sent', 'A verified legal advocate sent a confidential follow-up message to the complainant.')`,
        [incident.id, incident.status]
      );

      const newMsg = insertResult.rows[0];
      newMsg.is_mine = true;

      return res.json({ success: true, message: newMsg });
    }

    // For drafting messages, court briefs, or case legal assessment
    const result = await handleLawyerAiAssist({
      action,
      caseId,
      pool,
      user: req.user,
      payload
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'AI assistance failed.' });
    }

    return res.json(result);
  } catch (error) {
    console.error('[Lawyer AI Assist API Error]:', error.message);
    return res.status(500).json({ error: 'Advocate AI Assistant is temporarily unavailable. Please try again.' });
  }
});
  }

  try {
    const result = await handleAiAssistantQuery({ userMessage, caseId, pool });
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'The AI assistant could not process your request.' });
    }
    return res.json(result);
  } catch (error) {
    console.error('AI assistant route error:', error.message);
    return res.status(500).json({ error: 'Failed to consult the AI assistant. Please try again.' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Choose a file up to 25 MB.'
      : 'The evidence upload could not be processed.';
    return res.status(400).json({ error: message });
  }
  if (error instanceof SyntaxError && error.status === 400 && error.body) {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  console.error('Unexpected server error:', error);
  return res.status(500).json({ error: 'Something went wrong.' });
});

const server = app.listen(port, () => {
  console.log(`Ona Polisi server running at http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
