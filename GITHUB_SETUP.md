# Connect 2hotatl to GitHub (one-time)

The project is committed locally on branch `main`. Finish these steps in your browser.

## 1. Create the repo on GitHub

1. Open https://github.com/new
2. **Repository name:** `2hotatl` (or `phone-hand`)
3. **Private** recommended (remote-control app)
4. Do **not** add README, .gitignore, or license (already in project)
5. Click **Create repository**

## 2. Push from your Mac

Replace `YOUR_USERNAME` and `REPO_NAME` with yours:

```bash
cd ~/Desktop/phone-hand
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

GitHub will ask you to sign in (browser or personal access token).

## 3. Connect Render

1. https://dashboard.render.com → **New → Web Service**
2. **Connect** your GitHub account → select this repo
3. Settings:
   - **Build:** `npm install && npm run build && node scripts/build-cjs.mjs`
   - **Start:** `node server.cjs`
   - **Plan:** Free
4. Deploy → copy URL → test `/api/health`

Or use **New → Blueprint** — Render reads `render.yaml` automatically.

## Personal access token (if push asks for password)

GitHub no longer accepts account passwords for git push.

1. GitHub → Settings → Developer settings → Personal access tokens
2. Generate token with `repo` scope
3. Use the token as the password when `git push` prompts
