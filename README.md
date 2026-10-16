# Little Day

A local-first baby nap planner built with React, TypeScript, and Vite. It estimates a flexible next-nap window from age-based wake windows, sleep logged in the last 24 hours, and the most recently logged nap.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, then serve the `dist` directory over HTTPS (or localhost). The web app manifest and service worker enable installation and offline app-shell access in supported browsers.

## Deploy

### Vercel

1. Import this repository in [Vercel](https://vercel.com/new) and authorize access to GitHub.
2. Keep the detected Vite settings: `npm run build` and `dist` as the output directory. The included `vercel.json` configures these settings.
3. Select **Deploy**. Vercel will build on each push to the connected production branch and create preview deployments for other branches and pull requests.

### GitHub Pages

1. Push this project to a GitHub repository with a `main` branch.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. Push to `main` or manually run **Deploy to GitHub Pages** from the repository's **Actions** tab. The workflow builds and publishes `dist`; project-site base paths are configured automatically.

For a GitHub Pages deployment from a branch other than `main`, edit the `branches` entry in `.github/workflows/deploy-pages.yml`.

## How the estimate works

The planner estimates the time for normalized sleep pressure to reach a target:

```text
S(t) = Smax - (Smax - S0) * e^(-t / tau_w)
T    = -tau_w * ln((Smax - Starget) / (Smax - S0))
```

The implementation uses normalized pressure units (`Smax = 1`) rather than measured biological values. Its age-band wake-window midpoint calibrates `tau_w` and the target so the baseline estimate stays at the current age-based timing. Recent sleep deficit raises the estimated starting pressure by up to the equivalent of 30 minutes earlier; a nap under 45 minutes raises it by the equivalent of 15 minutes earlier, and a nap over 90 minutes lowers it by the equivalent of 10 minutes later. The time-to-threshold equation then determines the estimate. The displayed window is centered on that estimate with 15 minutes on either side.

These are planning heuristics, not measurements of adenosine, sleep pressure, or an individual baby's biological threshold. Age bands and sleep needs are approximate; follow the baby's cues and consult a health professional for medical advice.

## Data and privacy

The profile, last wake-up, sleep history, and display preference are saved in this browser's `localStorage`. Logging a sleep updates the wake-window clock to its wake-up time, and a wake-up can also be logged separately at a selected past time. The sleep calendar splits overnight sessions across the local days they overlap and compares logged daily totals with an approximate age-based target. Nothing is uploaded or synchronized to another device. Clearing browser site data will remove the saved planner data; use **Clear saved data** in the app to remove it intentionally.
