require('dotenv').config();

const { randomBytes, scryptSync } = require('node:crypto');
const { Pool } = require('pg');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const allowWeakPassword = process.env.ADMIN_ALLOW_WEAK_PASSWORD === 'true';

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error('Set ADMIN_EMAIL to a valid email address.');
}
if (password.length < 12 && !allowWeakPassword) {
  throw new Error('Set ADMIN_PASSWORD to at least 12 characters.');
}
if (password.length < 12) console.warn('Warning: creating an admin account with a weak development-only password.');
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const salt = randomBytes(16).toString('hex');
const derivedKey = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
const passwordHash = `scrypt$16384$8$1$${salt}$${derivedKey.toString('hex')}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
  if (existing.rowCount) {
    await pool.query(
      `UPDATE users
       SET password_hash = $1, role = 'admin', verification_status = 'verified'
       WHERE id = $2`,
      [passwordHash, existing.rows[0].id],
    );
    console.log(`Updated admin account: ${email}`);
  } else {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, verification_status)
       VALUES ($1, $2, 'admin', 'verified')`,
      [email, passwordHash],
    );
    console.log(`Created admin account: ${email}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
