/**
 * checkRules.mjs — exercises firestore.rules against the Firestore emulator.
 *
 * Run it with:
 *
 *   firebase emulators:exec --only firestore --project demo-runbo "node scripts/checkRules.mjs"
 *
 * `emulators:exec` loads firestore.rules (via firebase.json), starts the emulator,
 * sets FIRESTORE_EMULATOR_HOST, runs this script and exits with its exit code.
 *
 * No dependencies: it talks to the emulator's REST API with global fetch (node 18+).
 *
 * How the auth is faked: the emulator accepts unsigned JWTs — header `{"alg":"none"}`,
 * a payload carrying sub/user_id/email, and an empty signature — exactly what
 * @firebase/rules-unit-testing sends. The literal token `owner` bypasses the rules
 * entirely and is used here only to seed and to wipe fixture data.
 *
 * What it asserts:
 *   (a) a signed-in but NON-allowlisted user can read config/allowlist and nothing else
 *   (b) allowlisted user A cannot read user B's profile, sessions or bodyweight
 *   (c) allowlisted user A can read and write its own documents
 * plus: an unauthenticated caller is denied everything, and a sessions query that is
 * not scoped by `uid` is rejected outright.
 */

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
const PROJECT = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-runbo'
const ROOT = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

const USER_A = { uid: 'uid-alice', email: 'alice@example.com' }
const USER_B = { uid: 'uid-bob', email: 'bob@example.com' }
const OUTSIDER = { uid: 'uid-mallory', email: 'mallory@example.com' }

// --- tiny test harness -----------------------------------------------------

let passed = 0
const failures = []

function record(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name} — ${detail}`)
    console.log(`  FAIL ${name} — ${detail}`)
  }
}

function allowed(name, res) {
  record(name, res.status === 200, `expected 200, got ${res.status} ${res.text}`)
}

/** A read the rules allow, of a document that does not exist: 404, never 403. */
function allowedMissing(name, res) {
  record(name, res.status === 404, `expected 404 (allowed but absent), got ${res.status} ${res.text}`)
}

function denied(name, res) {
  record(name, res.status === 403, `expected 403 PERMISSION_DENIED, got ${res.status} ${res.text}`)
}

// --- emulator plumbing -----------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function token(user) {
  if (!user) return null
  const now = Math.floor(Date.now() / 1000)
  const header = b64url({ alg: 'none', kid: 'fakekid', typ: 'JWT' })
  const payload = b64url({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    sub: user.uid,
    user_id: user.uid,
    email: user.email,
    email_verified: true,
    firebase: {
      sign_in_provider: 'google.com',
      identities: { 'google.com': [user.uid], email: [user.email] },
    },
  })
  return `${header}.${payload}.`
}

async function call(method, path, { as, body, query } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const bearer = as === 'owner' ? 'owner' : token(as)
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const url = `${ROOT}${path}${query ? `?${query}` : ''}`
  // Built conditionally rather than passing `body: undefined`: a `body` key on a
  // GET is invalid fetch options, and static analysis flags it even when unset.
  const init = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(url, init)
  const text = await res.text()
  return { status: res.status, text: text.slice(0, 300) }
}

const get = (path, as) => call('GET', path, { as })
const patch = (path, fields, as) => call('PATCH', path, { as, body: { fields } })
const del = (path, as) => call('DELETE', path, { as })

/** A `where uid == <uid>` query, or an unscoped one when uid is null. */
function runQuery(collectionId, uid, as) {
  const structuredQuery = { from: [{ collectionId }] }
  if (uid) {
    structuredQuery.where = {
      fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } },
    }
  }
  return call('POST', ':runQuery', { as, body: { structuredQuery } })
}

const str = (v) => ({ stringValue: v })

async function wipe() {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  })
  if (!res.ok) throw new Error(`could not clear emulator data: ${res.status} ${await res.text()}`)
}

async function seed() {
  // Written as `owner`, which bypasses the rules — this is the state the rules
  // are then evaluated against, not part of what is being tested.
  await patch(
    '/config/allowlist',
    {
      emails: { arrayValue: { values: [str(USER_A.email), str(USER_B.email)] } },
    },
    'owner',
  )
  await patch('/config/featureFlags', { experimental: { booleanValue: true } }, 'owner')
  await patch(`/profiles/${USER_A.uid}`, { displayName: str('Alice') }, 'owner')
  await patch(`/profiles/${USER_B.uid}`, { displayName: str('Bob') }, 'owner')
  await patch('/sessions/session-a', { uid: str(USER_A.uid), date: str('2026-01-01') }, 'owner')
  await patch('/sessions/session-b', { uid: str(USER_B.uid), date: str('2026-01-01') }, 'owner')
  await patch('/bodyweight/bw-b', { uid: str(USER_B.uid), kg: { doubleValue: 80 } }, 'owner')
  await patch(`/stravaAccounts/${USER_A.uid}`, { accessToken: str('secret') }, 'owner')
}

// --- the three cases -------------------------------------------------------

async function nonAllowlistedUser() {
  console.log('\n(a) signed in but NOT on the allowlist — config only, nothing else')
  const m = OUTSIDER
  allowed('reads config/allowlist (so the UI can say "not allowlisted")', await get('/config/allowlist', m))
  denied('cannot read another config document', await get('/config/featureFlags', m))
  denied(
    'cannot write config/allowlist',
    await patch('/config/allowlist', { emails: { arrayValue: { values: [str(m.email)] } } }, m),
  )
  denied('cannot read its own profile', await get(`/profiles/${m.uid}`, m))
  denied('cannot write its own profile', await patch(`/profiles/${m.uid}`, { displayName: str('Mallory') }, m))
  denied('cannot get a session', await get('/sessions/session-a', m))
  denied('cannot query sessions scoped to itself', await runQuery('sessions', m.uid, m))
  denied('cannot create a session', await patch('/sessions/mallory-1', { uid: str(m.uid) }, m))
  denied('cannot query bodyweight scoped to itself', await runQuery('bodyweight', m.uid, m))
  denied('cannot read stravaAccounts', await get(`/stravaAccounts/${m.uid}`, m))
}

async function crossUser() {
  console.log("\n(b) allowlisted user A cannot touch user B's data")
  const a = USER_A
  denied("cannot read B's profile", await get(`/profiles/${USER_B.uid}`, a))
  denied("cannot write B's profile", await patch(`/profiles/${USER_B.uid}`, { displayName: str('pwned') }, a))
  denied("cannot get B's session", await get('/sessions/session-b', a))
  denied("cannot query B's sessions", await runQuery('sessions', USER_B.uid, a))
  denied('cannot query sessions unscoped by uid', await runQuery('sessions', null, a))
  denied("cannot delete B's session", await del('/sessions/session-b', a))
  denied("cannot take over B's session by re-pointing uid", await patch('/sessions/session-b', { uid: str(a.uid) }, a))
  denied('cannot create a session owned by B', await patch('/sessions/planted', { uid: str(USER_B.uid) }, a))
  denied("cannot get B's bodyweight", await get('/bodyweight/bw-b', a))
  denied('cannot query bodyweight unscoped by uid', await runQuery('bodyweight', null, a))
  denied('cannot read stravaAccounts, not even its own', await get(`/stravaAccounts/${a.uid}`, a))
}

async function ownData() {
  console.log('\n(c) allowlisted user A can read and write its own data')
  const a = USER_A
  allowed('reads config/allowlist', await get('/config/allowlist', a))
  allowed('reads its own profile', await get(`/profiles/${a.uid}`, a))
  allowed('writes its own profile', await patch(`/profiles/${a.uid}`, { displayName: str('Alice v2') }, a))
  allowed('gets its own session', await get('/sessions/session-a', a))
  allowedMissing('gets a missing session: 404, not permission-denied', await get('/sessions/does-not-exist', a))
  allowed('queries its own sessions', await runQuery('sessions', a.uid, a))
  allowed(
    'creates a session of its own',
    await patch('/sessions/session-a2', { uid: str(a.uid), date: str('2026-01-02') }, a),
  )
  allowed(
    'updates its own session',
    await patch('/sessions/session-a2', { uid: str(a.uid), date: str('2026-01-03') }, a),
  )
  allowed('deletes its own session', await del('/sessions/session-a2', a))
  allowed(
    'creates its own bodyweight entry',
    await patch('/bodyweight/bw-a', { uid: str(a.uid), kg: { doubleValue: 75 } }, a),
  )
  allowed('queries its own bodyweight', await runQuery('bodyweight', a.uid, a))
  allowed('deletes its own bodyweight entry', await del('/bodyweight/bw-a', a))
}

async function anonymous() {
  console.log('\n(d) not signed in at all — denied everywhere, allowlist included')
  denied('cannot read config/allowlist', await get('/config/allowlist', null))
  denied('cannot read a profile', await get(`/profiles/${USER_A.uid}`, null))
  denied('cannot get a session', await get('/sessions/session-a', null))
  denied('cannot query sessions', await runQuery('sessions', USER_A.uid, null))
}

// --- entry point -----------------------------------------------------------

async function main() {
  console.log(`firestore.rules check — emulator ${HOST}, project ${PROJECT}`)

  try {
    await wipe()
  } catch (error) {
    console.error(
      `\nCould not reach the Firestore emulator at ${HOST}.\n` +
        'Run this through:\n' +
        '  firebase emulators:exec --only firestore --project demo-runbo "node scripts/checkRules.mjs"\n',
    )
    console.error(String(error))
    process.exit(2)
  }

  await seed()
  await nonAllowlistedUser()
  await crossUser()
  await ownData()
  await anonymous()
  await wipe()

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
