# Wizards of the West — Complete Firebase + GitHub Pages setup

This version includes account authentication, persistent statistics, random matchmaking, direct email challenges, live Firebase game rooms, and guest fallback.

## 1. Put the files at the repository root

Upload these files directly into your GitHub repository:

- index.html
- app.js
- style.css
- firebase-config.js
- .nojekyll

Do NOT put them inside `public/`.

The repository should look like:

wizards-of-the-west/
  index.html
  app.js
  style.css
  firebase-config.js
  .nojekyll

## 2. Create the Firebase project

Open Firebase Console:
https://console.firebase.google.com/

Click **Create a project**.

A simple name such as `wizards-of-the-west` is fine.

After the project exists, you need three Firebase products:

### Authentication

Firebase Console → Build → Authentication → Get started → Sign-in method.

Enable:
- Google
- Email/Password

Google is for the Google button. Email/Password lets players register and sign in directly.

### Realtime Database

Firebase Console → Build → Realtime Database → Create Database.

This is used for:
- matchmaking queue
- live room state
- moves during a match

Choose a database location and create it.

### Firestore

Firebase Console → Build → Firestore Database → Create database.

This is used for:
- player records
- wins/losses
- direct challenges

## 3. Register the website as a Firebase Web App

Firebase Console → gear icon → Project settings.

Scroll to **Your apps** and click the Web icon (`</>`).

Register a web app. The app name can be `Wizards of the West`.

Firebase will show a `firebaseConfig` object.

Open the downloaded `firebase-config.js`.

Replace the placeholders:

`PASTE_API_KEY_HERE`
`PASTE_PROJECT_ID`
`PASTE_MESSAGING_SENDER_ID`
`PASTE_APP_ID`

with the values from Firebase.

Leave:

`firebaseEnabled = true`

Do not put Firebase service-account private keys in this file. The normal Web App config is intended to be used by browser applications.

## 4. Authorize GitHub Pages

Firebase Console → Authentication → Settings → Authorized domains.

Add the domain GitHub Pages uses.

For a normal project site this is usually:

`YOUR-GITHUB-USERNAME.github.io`

Do not add `/repository-name` to the domain field.

This step is especially important for Google sign-in.

## 5. Publish the Firebase security rules

### Realtime Database

Firebase Console → Build → Realtime Database → Rules.

Replace the rules with the contents of:

`database.rules.json`

Click Publish.

### Firestore

Firebase Console → Build → Firestore Database → Rules.

Replace the rules with the contents of:

`firestore.rules`

Click Publish.

## 6. Enable GitHub Pages

GitHub repository → Settings → Pages.

Under Build and deployment select:

**Source:** Deploy from a branch

Then:

**Branch:** main
**Folder:** / (root)

Click Save.

Wait for GitHub to finish deploying.

Your site should then be available at a URL like:

`https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/`

## 7. First test: guest mode

Open the published site.

Click **Play as Guest**.

Guest mode does not require a Firebase account. It uses the browser's local storage for guest statistics.

Play a battle and verify that the game works.

## 8. Second test: Google

Click **Sign in with Google**.

Complete Google's login flow.

If Google says the domain is not authorized, return to:

Firebase → Authentication → Settings → Authorized domains

and add the GitHub Pages domain.

After signing in, the account's player record is created in Firestore under:

`players/<Firebase UID>`

## 9. Third test: Email/Password

Click **Sign in / Register with Email**.

Enter an email address and a password of at least 6 characters.

If the account doesn't exist, the site attempts to register it. If it already exists, it attempts to sign in.

## 10. Test random matchmaking

You need two different signed-in Firebase accounts.

The easiest test is:
- Account A in one browser
- Account B in another browser or an incognito window

On both, sign in.

Account A clicks **Find Random Opponent**.

Account B does the same.

The first available opponent is paired into a Firebase Realtime Database room.

The room keeps:
- both player IDs
- each player's ammo
- each player's mana
- each player's move
- turn number
- living/dead state
- clash timing

## 11. Test direct challenges

Both players must have Firebase accounts.

Player A:
1. Click **Challenge by Email**.
2. Enter Player B's account email.
3. Click **Send Challenge**.

Player B should see an incoming challenge.

Player B clicks **Accept**.

Both clients then enter the same Firebase room.

## 12. If Firebase fails

The website deliberately has a guest fallback.

If Firebase cannot load or isn't configured correctly, the page does not become unusable. **Play as Guest** still starts a local battle.

This is useful for testing the game before Firebase is configured.

## 13. Important security limitation

This is a functional browser multiplayer prototype, not a cheat-proof competitive server.

The browser is responsible for submitting moves, so a technically knowledgeable player could modify the JavaScript or Firebase requests.

For a serious competitive version, combat resolution should be moved to a trusted backend/Cloud Function so the server—not the player's browser—decides whether a move is legal and who wins.

## 14. If GitHub shows the README instead of the game

Check these two things:

1. `index.html` is directly in the repository root.
2. GitHub Pages is set to `main` + `/ (root)`.

You should NOT have:

`repository/public/index.html`

or:

`repository/wizards_of_the_west/index.html`

The correct location is:

`repository/index.html`

## 15. If the site loads but Firebase does not

Check `firebase-config.js`.

Make sure:
- `firebaseEnabled` is `true`
- `apiKey` isn't a placeholder
- `authDomain` uses your project ID
- `databaseURL` is your actual Realtime Database URL
- `projectId` is correct
- `messagingSenderId` is correct
- `appId` is correct

Then reload the GitHub Pages site.

## 16. What each Firebase service does

Authentication = who the player is.

Firestore = account/player information and challenges.

Realtime Database = fast-changing multiplayer state.

GitHub Pages = serves the website.

The browser JavaScript = displays the game and communicates with Firebase.
