# Wizards of the West — Firebase setup

This version separates Google sign-in, email sign-in, and email account creation. It also uses an exact email-to-UID lookup for challenges and resolves online turns atomically after both players have locked in their moves.

## 1. Firebase project

Create/open the Firebase project used by the game.

### Authentication

Firebase Console → Authentication → Sign-in method:

- Enable **Google**.
- Enable **Email/Password**.

Email/Password is required for the **Create Email Account** and **Sign in with Email** buttons.

### Web app

Firebase Console → Project settings → Your apps → Web app.

Copy that web app's configuration into `firebase-config.js`.

The values must belong to the same Firebase project as the Authentication, Firestore, and Realtime Database services.

### Realtime Database

Firebase Console → Build → Realtime Database → Create database.

Copy the **Database URL shown by Firebase** into `firebase-config.js` as `databaseURL`. Do not construct it manually. Firebase documents that the URL may be either `firebaseio.com` or a regional `firebasedatabase.app` URL depending on the database location.

Publish the contents of `database.rules.json` in:

Realtime Database → Rules

### Firestore

Firebase Console → Build → Firestore Database → Create database.

Publish `firestore.rules` in:

Firestore Database → Rules

Do not use the old Firestore rules from an earlier version of this project.

## 2. Authentication authorized domain

Firebase Console → Authentication → Settings → Authorized domains.

Add your GitHub Pages hostname, for example:

`yourusername.github.io`

If you use a custom domain, add that domain too.

`localhost` is normally already present for local testing.

## 3. GitHub Pages

Put these files directly in the repository root:

- index.html
- app.js
- style.css
- firebase-config.js
- database.rules.json
- firestore.rules

Then:

GitHub → repository → Settings → Pages

Choose:

- Deploy from a branch
- your main branch
- folder: `/ (root)`

Do not put `index.html` inside a `public` folder for this build.

## 4. Test in this order

1. Open the GitHub Pages site.
2. Confirm the bottom status says **Firebase connected**.
3. Click **Sign in with Google**.
4. Confirm your Google account appears.
5. Open Firebase Console → Authentication → Users and confirm the user exists.
6. Click **Create Email Account** with a NEW email and password.
7. Confirm the email account appears under Authentication → Users.
8. Sign out and test **Sign in with Email**.
9. Sign in with two Google accounts in two browser profiles/windows.
10. Use **Challenge by Email** from one account to the other.
11. Accept the challenge on the second account.
12. In the battle, each player selects a move independently. A move is locked locally; the turn does not resolve until both moves exist in the same Firebase room state.

## 5. If Firebase says it is not connected

Open F12 → Console and reload the page.

This build distinguishes SDK initialization from Realtime Database connection. The page also watches Firebase's special `/.info/connected` location.

Check these first:

- `firebaseEnabled` is `true`.
- `apiKey`, `authDomain`, `databaseURL`, `projectId`, `messagingSenderId`, and `appId` are from the same Firebase Web App.
- The Realtime Database actually exists.
- `databaseURL` is copied from Firebase's Realtime Database page.
- Realtime Database rules are published.
- The GitHub Pages domain is an authorized Authentication domain.

## 6. If email account creation fails

The error now distinguishes common causes:

- Email/password provider disabled → enable Email/Password in Authentication → Sign-in method.
- Email already exists → use Sign in with Email.
- Weak password → use at least 6 characters (or satisfy any stronger password policy configured in Firebase).
- Invalid email → use a valid email address.

The game no longer treats `auth/invalid-credential` as an invitation to silently create an account.

## 7. If direct challenges fail

Both players must be signed in.

The sender's account must have a `playerLookup` document. The game creates that automatically when a user signs in successfully.

If you changed Firestore rules manually, republish the included `firestore.rules`.

## 8. What the online combat does

A player selecting a move does not immediately resolve the attack.

Each player gets one independent move field in the shared room state. The server-side Realtime Database transaction only resolves the turn once both fields are present. The transaction then writes the complete result at once.

For H-vs-H and J-vs-J clashes, both clients submit their clash timestamp with their locked move. The lower timestamp wins; an exact tie is a double KO.

The browser client is still not a cheat-proof competitive server. A determined user can modify browser code. This build is intended for a private/friend multiplayer game on GitHub Pages.
