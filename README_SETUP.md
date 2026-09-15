# Wizards of the West

## GitHub Pages
Put `index.html`, `app.js`, `style.css`, `firebase-config.js`, and `.nojekyll` in the **root of the GitHub repository**.

Then:
1. GitHub → Settings → Pages
2. Source: Deploy from a branch
3. Select your branch and **/(root)**
4. Save

Do NOT select `/docs` and do not leave the website inside a `public/` folder unless you configure a workflow to publish that folder.

The site has a **Play without an account** button and automatically falls back to guest mode when Firebase is not configured or cannot initialize.

Firebase is only needed for Google/email accounts, saved cloud records, random online matchmaking, and email challenges.
