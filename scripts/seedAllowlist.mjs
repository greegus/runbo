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
 * THIS SCRIPT IS FOR THE EMULATOR ONLY. It refuses to run against a real
 * project: production's allowlist is edited by hand in the Firebase console, on
 * purpose, so that adding a user is a deliberate act and not a script anyone can
 * point at the wrong database.
 */

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
const PROJECT = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-runbo'
const ROOT = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

/**
 * Who may sign in locally. Add an address here and re-run.
 * The first entry is the account the app is built for.
 */
const EMAILS = ['matus.duchon@gmail.com', ...process.argv.slice(2)]

if (!PROJECT.startsWith('demo-')) {
  console.error(
    `Refusing to run against project "${PROJECT}".\n` +
      'This script only seeds a Firestore emulator (a "demo-*" project id).\n' +
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
