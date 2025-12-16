## Goal
Push the current local changes to your GitHub repository at `git@github.com:tokyohacker2025/captions.events.git`.

## Steps

### 1) Keep upstream and add your origin
- Rename existing remote:
  - `git remote rename origin upstream`
- Add your repo as the new origin (SSH recommended):
  - `git remote add origin git@github.com:tokyohacker2025/captions.events.git`
- Verify:
  - `git remote -v` (should show `origin` → your repo, `upstream` → elevenlabs)

### 2) Ensure you won’t commit local tool folders
- `.env*` is already ignored by `.gitignore` (line 20), so secrets won’t be committed.
- If you don’t want `.trae/` committed, add it to `.gitignore`:
  - `echo ".trae" >> .gitignore`

### 3) Stage files for commit
- Stage tracked modifications:
  - `git add components/broadcaster-interface.tsx components/viewer-interface.tsx`
- Stage new files/directories:
  - `git add app/api/translations supabase/migrations/20251217090000_event_translations.sql supabase/migrations/20251217090500_translations.sql`
- Check status:
  - `git status`

### 4) Commit with a clear message
- `git commit -m "feat: server-side translations, realtime syncing, UI fixes; add migrations and API route"`

### 5) Push to your origin
- Set upstream and push:
  - `git push -u origin main`
- If the branch doesn’t exist remotely yet, this will create it.

### 6) Optional: Keep upstream for future pulls
- To sync changes from the original repo later:
  - `git fetch upstream`
  - `git merge upstream/main` (or `git rebase upstream/main`)

### 7) Confirm on GitHub
- Open your repo page and confirm the new commit appears on `main`.

If you want, I can produce the exact commands in one block you can paste into your terminal.