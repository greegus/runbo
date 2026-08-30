/**
 * seedAllowlist.mjs — writes `config/allowlist` so you can actually sign in.
 *
 * The rules gate every collection on this one document. Until it exists, every
 * signed-in account resolves to `notAllowlisted` and the app shows the
 * ask-for-access screen — including yours. That is the bootstrap trap, and this
 * script is the way out of it locally.
 *
 * Against the emulator (the usual case):
 *
 *   firebase emulators:start --only auth,firestore --project demo-runbo
 *   npm run seed:allowlist
 *
 * The emulator starts empty every time unless you run it with --import, so
 * expect to re-run this after each cold start.
 *
 * Emails are lowercased on the way in. The rules compare against
 * `request.auth.token.email` lowercased, so a capitalised entry would never
 * match and the failure would look like "my account is not on the list".
 *
 * No dependencies: it talks to the emulator's REST API with global fetch.
 * The literal bearer token `owner` bypasses the rules, which is what lets this
 * write a document the client is forbidden to write.
 *
 * THIS SCRIPT IS FOR THE EMULATOR ONLY, and what makes that true is the HOST,
 * not the project id. Production's allowlist is edited by hand in the Firebase
 * console, on purpose, so that granting access stays a deliberate act.
 *
 * Seed the project id the app actually signs in with — the one in `.env.local`,
 * `runbo-d2dff`. The emulator keeps a separate namespace per project id, so
 * seeding `demo-runbo` while the client asks for `runbo-d2dff` writes a document
 * the app will never read, and the failure looks exactly like a rejected
 * account. Pass `--project` (or set GCLOUD_PROJECT) to override.
 */

const args = process.argv.slice(2)

function takeOption(name) {
  const at = args.indexOf(name)
  if (at === -1) return undefined
  return args.splice(at, 2)[1]
}

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'

/** Must match the projectId the app signs in with, i.e. `.env.local`. */
const PROJECT = takeOption('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'runbo-d2dff'

const ROOT = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

/**
 * Who may sign in locally. Add an address here and re-run; anything left on the
 * command line is added too. The first entry is the account the app is for.
 */
const EMAILS = ['matus.duchon@gmail.com', ...args]

// The safety property is the HOST, not the project id: a local emulator is safe
// to write whatever it is called, and production is unsafe whatever it is
// called. Guarding on a "demo-" prefix would have refused the very project id
// the app actually uses while still allowing a misconfigured host through.
const hostname = HOST.split(':')[0]
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(hostname)) {
  console.error(
    `Refusing to write to "${HOST}".\n` +
      'This script only seeds a Firestore emulator running locally.\n' +
      'To grant access in the real project, edit config/allowlist in the Firebase console.',
  )
  process.exit(1)
}

const emails = [...new Set(EMAILS.map((email) => email.trim().toLowerCase()).filter(Boolean))]

if (emails.length === 0) {
  console.error('No emails to write.')
  process.exit(1)
}

const res = await fetch(`${ROOT}/config/allowlist`, {
  method: 'PATCH',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: { emails: { arrayValue: { values: emails.map((email) => ({ stringValue: email })) } } },
  }),
}).catch((error) => {
  console.error(
    `Could not reach the Firestore emulator at ${HOST}.\n` +
      'Start it first:  firebase emulators:start --only auth,firestore --project demo-runbo\n' +
      String(error),
  )
  process.exit(1)
})

if (!res.ok) {
  console.error(`Write failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}

console.log(`Allowlisted in ${PROJECT}:`)
for (const email of emails) console.log(`  ${email}`)
