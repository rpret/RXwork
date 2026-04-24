# 💊 Rx Scheduler — Pharmacy Schedule Builder

A lightweight, single-page web app for building weekly pharmacy schedules. No backend, no build step — just open the folder in a browser or deploy to any static host.

## Features

- ✅ **Add / edit / delete employees** (Full-Time & Part-Time)
- ✅ **Click any cell** to assign a shift from presets or custom times
- ✅ **Live budget tracker** — scheduled hours vs base & max budget
- ✅ **Coverage bar** — daily staff count, closers, and short shifts at a glance
- ✅ **Store hours** — configure open/close per day of the week
- ✅ **Week navigation** — browse past and future weeks
- ✅ **Closing-shift detection** — auto-badges techs staying till close
- ✅ **Short-shift detection** — auto-stars shifts ≤ 5 hours (e.g. till 1:30)
- ✅ **Meal break** — shifts ≥ 6 hours automatically deduct 30 min
- ✅ **Export to CSV** — download the week as a spreadsheet
- ✅ **Print view** — clean printout of the schedule table
- ✅ **Persisted locally** — schedule saves to browser localStorage automatically

---

## Deploy to GitHub Pages

1. Create a new GitHub repository (public or private)
2. Upload these three files:
   - `index.html`
   - `style.css`
   - `app.js`
3. Go to **Settings → Pages**
4. Under "Source", select **Deploy from a branch** → `main` → `/ (root)`
5. Click **Save** — your site will be live at `https://yourusername.github.io/your-repo-name`

---

## Deploy to Cloudflare Pages

1. Push the files to a GitHub repository (see above)
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages**
3. Click **Connect to Git** → select your repo
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/` (root)
5. Click **Save and Deploy**

Your app will be available at `https://your-project.pages.dev` with a free SSL certificate and automatic deploys on every push.

---

## Usage Guide

### Adding Employees
Click **+ Add Employee** in the top right. Set their name, type (FT/PT), target hours, minimum hours, and optional role.

### Building the Schedule
Click any **"+ Shift"** cell in the grid to open the shift picker for that employee and day. Choose from:
- **Preset shifts** (common pharmacy patterns — openers, closers, short mids)
- **Custom shift** — enter any start/end time
- **Mark as Day Off** — clears any existing shift

### Reading the Schedule
- 🔵 **Blue shifts** = Full-Time opener/mid
- 🟣 **Purple "C" badge** = Closing shift (tech stays till store close)
- 🟡 **Gold "★" badge** = Short shift (≤ 5 hours, e.g. till 1:30)
- 🟢 **Green "C" badge** = Closing shift for PT tech

### Budget Tracker
The sidebar shows live % of base budget used. Color coding:
- 🟢 Green = under base budget
- 🟡 Yellow = over base budget but under max
- 🔴 Red = over maximum allowed hours

### Store Hours
Configure each day's open and close times in the sidebar. Close time is used to automatically detect "closing shifts."

---

## Data Storage

All data is saved to **browser localStorage** — nothing leaves the device. Clearing browser data will reset the schedule. For a shared/multi-device setup, consider exporting to CSV weekly.

---

*Built for Larisa's pharmacy team. Powered by vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies.*
