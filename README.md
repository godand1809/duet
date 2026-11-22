# Duet

A private two-player game table for phones. Darts (501 and Cricket), two-handed Spades, heads-up no-limit Hold'em, 8-ball, and Battleship.

Play **pass-and-play** on one phone, or **two phones** (Android Chrome and iPhone Safari) with a 5-character room code. The second phone joins by link or QR code over a direct WebRTC connection. There is no account, no analytics, and no server that sees your cards or ship coordinates.

## Add to your home screen

Open the site in Chrome or Safari, then use **Add to Home Screen**. The app runs standalone. Sound unlocks on the first tap. A mute switch and a **Reset all local data** button live in Settings. Names, theme, and results stay in `localStorage` on that device.

If a strict mobile network blocks the peer connection, the table says so. Use Wi-Fi, or pass one phone back and forth.

## Publish on GitHub Pages

1. Push this project to a GitHub repository (the default branch should be `main`).
2. In the repository, open **Settings → Pages → Build and deployment**, and choose **GitHub Actions**.
3. The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs `npm install` and `npm run build` on every push to `main`, then deploys the `./dist` folder.
4. The site will be at `https://<username>.github.io/<repo>/`.

Assets are built with a relative base (`./`) so they load under a project subpath. The web app manifest and service worker also use relative paths.

`npm run build` produces the static site in `dist/` (and still runs the app's normal production build). You do not need a database or any API key for Pages.
