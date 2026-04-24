# Deploying Rx Scheduler to GitHub + Cloudflare Pages

## First-time setup (Git Bash)

### 1. Install Git (if not already installed)
Download from https://git-scm.com/download/win — Git Bash is included.

### 2. Create a GitHub repository
1. Go to https://github.com/new
2. Name it something like `pharmacy-scheduler`
3. Set it to **Public** (required for free GitHub Pages) or Private (Cloudflare Pages works with both)
4. Do NOT initialize with README — you'll push your own files
5. Click **Create repository**
6. Copy the repository URL shown (e.g. `https://github.com/yourusername/pharmacy-scheduler.git`)

---

## Push the app files (Git Bash)

Open **Git Bash** in the folder where you have the 3 app files (`index.html`, `style.css`, `app.js`).

```bash
# 1. Initialize git in your folder
git init

# 2. Stage all files
git add .

# 3. First commit
git commit -m "Initial: Rx Scheduler pharmacy app"

# 4. Set main as default branch
git branch -M main

# 5. Connect to your GitHub repo (replace URL with yours)
git remote add origin https://github.com/yourusername/pharmacy-scheduler.git

# 6. Push!
git push -u origin main
```

You'll be prompted for your GitHub username and password.
> **Note:** GitHub no longer accepts passwords — use a **Personal Access Token** instead.
> Create one at: GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → Generate new token
> Give it `repo` scope. Use that token as your password.

---

## Deploy to Cloudflare Pages

1. Go to https://dash.cloudflare.com
2. Click **Workers & Pages** → **Create application** → **Pages** tab
3. Click **Connect to Git** → Authorize Cloudflare → Select your `pharmacy-scheduler` repo
4. Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/`  ← type a forward slash
5. Click **Save and Deploy**

Your app is live at: `https://pharmacy-scheduler.pages.dev` (or similar)

---

## Pushing updates (every time you change files)

```bash
# In Git Bash, from your project folder:

git add .
git commit -m "Update: describe what changed"
git push
```

Cloudflare Pages will automatically redeploy within ~1 minute of every push. ✓

---

## Useful Git Bash commands

| Command | What it does |
|---|---|
| `git status` | See which files have changed |
| `git log --oneline` | See commit history |
| `git diff` | See exact line changes |
| `git pull` | Download latest from GitHub |
| `git add filename.js` | Stage a specific file only |
| `git restore filename.js` | Undo changes to a file |

---

## Troubleshooting

**"Permission denied" or auth error**
→ Use a Personal Access Token (see note above), not your GitHub password.

**"remote origin already exists"**
→ Run `git remote set-url origin https://github.com/yourusername/pharmacy-scheduler.git`

**Cloudflare shows old version**
→ Check the Pages dashboard for build status — it shows live deploy logs.

**App works locally but not on Cloudflare**
→ Make sure all 3 files (`index.html`, `style.css`, `app.js`) are in the root of the repo, not in a subfolder.
