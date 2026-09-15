## Quick deployment

1. Fill in `public/firebase-config.js`.
2. Create the Firebase project and enable Auth (Google + Email/Password), Realtime Database, Firestore.
3. Install Firebase CLI: `npm install -g firebase-tools`
4. From this folder:
   `firebase login`
   `firebase use --add`
   `firebase deploy --only database,firestore,functions`
5. Push `public/` to your GitHub Pages site.
6. Add your `*.github.io` domain to Firebase Authentication -> Settings -> Authorized domains.

If you want a one-command GitHub Pages deployment later, add a GitHub Actions workflow that copies `public/` to Pages.
