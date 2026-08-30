#!/usr/bin/env bash
#
# Puts everything .github/workflows/deploy.yml needs into GitHub Actions secrets.
#
#   ./scripts/setupCiSecrets.sh
#
# Run it yourself — it creates a service account key, and a key is not something
# to hand to anyone, including an assistant. Nothing here prints a secret value.
#
# It is safe to re-run: the service account is only created if missing, and
# `gh secret set` overwrites.

set -euo pipefail

# Parsed rather than required: `.firebaserc` has no .json extension, so node
# would try to run it as JavaScript.
PROJECT="$(node -p "JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects.default" 2>/dev/null || echo '')"
SA_NAME="github-deploy"
ENV_FILE=".env.local"

# Roles: publish the site, push rules, push indexes, and call the APIs that do
# those. Deliberately not Owner or firebase.developAdmin — a CI key that can
# only deploy is a CI key that cannot delete your data.
ROLES=(
  roles/firebasehosting.admin
  roles/firebaserules.admin
  roles/datastore.indexAdmin
  roles/serviceusage.serviceUsageConsumer
)

die() { echo "error: $*" >&2; exit 1; }

# --- checks ------------------------------------------------------------------

[ -n "$PROJECT" ] || die "could not read the default project from .firebaserc"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found — the VITE_APP_FIREBASE_* values come from it"

command -v gh >/dev/null || die "gh is not installed"
command -v gcloud >/dev/null || die "gcloud is not installed"

gh auth status >/dev/null 2>&1 || die "gh is not logged in — run: gh auth login"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || die "gcloud is not logged in — run: gcloud auth login"

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

echo "project: $PROJECT"
echo "repo:    $REPO"
echo

# --- the client config -------------------------------------------------------
#
# These ship inside the JS bundle, so they are not sensitive — they live here
# because the repo should not carry one project's identity, not because they are
# a secret. Read straight from .env.local so CI and your machine cannot drift.

echo "Setting the VITE_APP_FIREBASE_* secrets from $ENV_FILE"

missing=0
while IFS='=' read -r key value; do
  case "$key" in
    VITE_APP_FIREBASE_*)
      if [ -z "$value" ]; then
        echo "  ! $key is empty in $ENV_FILE"
        missing=1
        continue
      fi
      printf '%s' "$value" | gh secret set "$key" --repo "$REPO" >/dev/null
      echo "  ✓ $key"
      ;;
  esac
done < <(grep -E '^VITE_APP_FIREBASE_[A-Z_]+=' "$ENV_FILE")

[ "$missing" -eq 0 ] || die "fill the empty values in $ENV_FILE and re-run"
echo

# --- the deploy key ----------------------------------------------------------

SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Service account $SA_EMAIL already exists"
else
  echo "Creating service account $SA_EMAIL"
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$PROJECT" \
    --display-name "GitHub Actions deploy" >/dev/null
fi

echo "Granting roles"
for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "$role" \
    --condition None >/dev/null
  echo "  ✓ $role"
done
echo

# The key exists on disk for as long as it takes to upload it, in a directory
# only this user can read, and is removed on any exit — including a failure.
KEY_DIR="$(mktemp -d)"
trap 'rm -rf "$KEY_DIR"' EXIT
KEY_FILE="$KEY_DIR/key.json"

echo "Creating a key and uploading it as FIREBASE_SERVICE_ACCOUNT"
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account "$SA_EMAIL" \
  --project "$PROJECT" >/dev/null 2>&1

gh secret set FIREBASE_SERVICE_ACCOUNT --repo "$REPO" < "$KEY_FILE" >/dev/null
echo "  ✓ FIREBASE_SERVICE_ACCOUNT"
echo

echo "Secrets now on $REPO:"
gh secret list --repo "$REPO"

cat <<'NOTE'

Done. Two things this script cannot do for you, both in the Firebase console:

  1. Enable Firestore — the API is off on this project, so a deploy of rules and
     indexes will fail until a database exists:
       https://console.firebase.google.com/project/PROJECT/firestore
  2. Enable Google sign-in, and add your production domain to the authorised
     domains list:
       https://console.firebase.google.com/project/PROJECT/authentication/providers

And create the allowlist document by hand once Firestore exists — collection
`config`, document `allowlist`, field `emails` (array), your address lowercase.
Without it every account, including yours, lands on the ask-for-access screen.
NOTE
