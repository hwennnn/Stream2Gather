// Makes a signed-in account for a browser test, with no test-only server route and
// no real sign-in: it writes the user row and signs the cookie with SESSION_KEY.
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import pg from 'pg';

/** PKCS#8 wrapping for a raw Ed25519 seed, which is all node:crypto can load. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const DAY_SECONDS = 86_400;

const signCookie = (seed, claims) => {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const payload = Buffer.from(JSON.stringify(claims));
  return `${payload.toString('base64url')}.${sign(null, payload, key).toString('base64url')}`;
};

/** Returns the account and the value of its s2g_session cookie. */
export const mintAccount = async (name, { databaseUrl = process.env.DATABASE_URL, sessionKey = process.env.SESSION_KEY } = {}) => {
  if (!databaseUrl || !sessionKey) throw new Error('mintAccount needs DATABASE_URL and SESSION_KEY');
  const id = `u_e2e${randomBytes(10).toString('hex')}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`INSERT INTO users (id, kind, clerk_id, display_name) VALUES ($1, 'clerk', $2, $3)`, [id, `e2e_${id}`, name]);
  await client.end();
  const cookie = signCookie(Buffer.from(sessionKey, 'base64'), {
    sub: id,
    name,
    acct: true,
    exp: Math.floor(Date.now() / 1000) + DAY_SECONDS,
  });
  return { id, name, cookie };
};

// Run directly, it prints one account for hands-on checks: node mint.mjs "Hana"
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await mintAccount(process.argv[2] ?? 'Hana')));
}
