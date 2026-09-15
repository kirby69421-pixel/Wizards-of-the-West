# Wizards of the West — GitHub Pages + Firebase

This converts the uploaded Pygame game into a browser game. The original game uses TCP sockets and a local `sav.json`; the web version replaces those with:

- Firebase Authentication: Google or email/password accounts.
- Firestore: persistent wins/losses.
- Firebase Realtime Database: live matches, random matchmaking, and challenges.
- GitHub Pages: hosts the static `public/` website.
- Firebase Cloud Function: creates the email -> user index used for direct challenges.

The combat rules are carried over from `main.py`, including W/S/A/D/H/J controls, ammo/mana, blocking/trash, mana shots, and shoot-vs-shoot / mana-shoot-vs-mana-shoot speed clashes.

## 1. Create the Firebase project

1. Go to the Firebase Console and create a project.
2. Add a **Web App** to the project.
3. Enable **Authentication**:
   - Google
   - Email/Password
4. Create a **Realtime Database**.
5. Create a **Firestore Database**.
6. Copy the Web App configuration into `public/firebase-config.js`.

## 2. Install Firebase CLI

Install Node.js, then:

    npm install -g firebase-tools
    firebase login

From this project directory:

    firebase use --add

Choose your Firebase project.

Then deploy the backend:

    firebase deploy --only database,firestore,functions

If Firebase asks to enable APIs/billing for Cloud Functions, follow its prompt. The frontend itself can remain on GitHub Pages.

## 3. GitHub Pages

Create a GitHub repository and upload:

    public/
    firebase.json
    database.rules.json
    firestore.rules
    firestore.indexes.json
    functions/
    README.md

For GitHub Pages, you can either:
- use the `public` folder as the Pages source if your GitHub setup supports it, or
- copy the contents of `public/` to the repository root and select the root as the Pages source.

The easiest setup is to make `public/` the published folder through your preferred GitHub Pages workflow. A workflow file is not included because GitHub's Pages configuration differs between repository types.

## 4. Important Firebase settings

In Firebase Authentication, add your GitHub Pages domain to **Authorized domains**.

For example, if your repository is `myname/wizards-of-the-west`, your Pages domain will normally resemble:

    myname.github.io

Do not put a password, service-account key, or Firebase Admin credential in the GitHub repository. The values in `firebase-config.js` are normal browser Firebase config values; security comes from Authentication and the Firebase rules.

## 5. Email challenges

The direct challenge feature is implemented as an in-game invitation addressed to the account registered with that email. It does **not** send a real email.

A player enters the opponent's account email, the challenge appears in the opponent's lobby, and they can accept it.

If you want an actual email notification too, add an email provider (such as SendGrid, Resend, or Postmark) through a server-side Cloud Function. Do not put an email-provider API key in GitHub Pages.

## 6. Security note

This is a playable first version, not an anti-cheat system. The browser is still the game client, so a determined player can modify their local JavaScript. For a competitive/public game, move authoritative combat resolution and matchmaking decisions into trusted server-side code.

## What changed from the Pygame version?

The uploaded `main.py` stores the record in `sav.json` and uses a raw TCP host/join flow. The browser version cannot listen on TCP port 5555 from GitHub Pages, so those pieces are replaced by Firebase services. The six original commands and combat resolution remain the same.
