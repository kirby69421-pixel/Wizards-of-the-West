# Wizards of the West — Firebase setup (fixed build)

## 1. Upload
Put `index.html`, `app.js`, `style.css`, `firebase-config.js`, and `.nojekyll` in the GitHub Pages repository root.

## 2. Firebase Web App
Firebase Console → Project settings → Your apps → Web app. Copy the Web App config into `firebase-config.js`. Keep `firebaseEnabled = true`. The `apiKey` in a normal Firebase web config is not a server secret. Never put a service-account private key in this file.

## 3. Authentication
Firebase Console → Authentication → Sign-in method:
- Enable **Google**.
- Enable **Email/Password**.

For Google sign-in, Authentication → Settings → Authorized domains must contain your GitHub Pages host, e.g. `yourname.github.io` (do not include the repository path).

## 4. Realtime Database
Create **Realtime Database**. Then open **Realtime Database → Rules** and paste the exact contents of `database.rules.json`, then **Publish**.

The rules in this build intentionally allow a signed-in participant to create a room containing their own UID and then let the two participants read/write that room. Do not add arbitrary public write access.

## 5. Firestore
Create **Cloud Firestore**. Open **Firestore Database → Rules**, replace the rules with the exact contents of `firestore.rules`, and click **Publish**.

This build uses:
- `players/<uid>` for persistent stats
- `playerLookup/<sha256-of-lowercase-email>` for exact email lookup
- `challenges/<id>` for invitations

The old build queried the entire `players` collection by email. This build does not.

## 6. GitHub Pages
Repository → Settings → Pages → Deploy from branch → `main` → `/ (root)`.

## 7. Test order
1. Open the site and verify the system message eventually says **Firebase connected**.
2. Sign in with Google.
3. Create a second Google account/player.
4. From player A, challenge player B by B's exact Google account email.
5. On B, press Accept.
6. Both players should enter the same room.
7. Each player chooses independently. A move is locked and waits; the turn resolves only after both moves exist.

## Email accounts
The Email Account button asks whether you want to sign in or create an account. Firebase's Email/Password provider must be enabled.

## If you still get permission-denied
The most common cause is that the rules were changed in the wrong Firebase product or were not published. There are **two separate rule editors**:
- Realtime Database → Rules → `database.rules.json`
- Firestore Database → Rules → `firestore.rules`

Do not paste Realtime Database JSON into Firestore, or Firestore rules into Realtime Database.

Also make sure the site's `databaseURL` in `firebase-config.js` is the exact URL shown by Firebase under Realtime Database.

## Important
This is browser multiplayer, so it is not cheat-proof. A production competitive game should move authoritative move validation/resolution to trusted server-side code.
