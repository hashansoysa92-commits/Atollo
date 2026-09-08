# Atollo

Google Apps Script marketplace web application prepared for GitHub + `clasp` development and production deployment.

## Project files

- `Code.gs` — Google Apps Script backend
- `Index.html` — public marketplace website
- `Member.html` — member login/dashboard
- `Admin.html` — administrator login/dashboard
- `appsscript.json` — Apps Script manifest
- `.github/workflows/deploy-apps-script.yml` — secure production deployment workflow

The four canonical Apps Script source files were restored and validated from the supplied source package. The backend passes a Node/V8 syntax check and the manifest is valid JSON.

## Apps Script manifest

The manifest is configured with:

- Time zone: `Indian/Maldives`
- Runtime: `V8`
- Exception logging: `STACKDRIVER`
- Spreadsheet scope
- Google Drive scope
- Mail sending scope
- Web app execution: deploying user
- Web app access: anonymous/public

## GitHub Actions production deployment

The repository includes a manual workflow named **Deploy Atollo to Google Apps Script**. It validates the project, pushes the complete source with the current `@google/clasp` CLI, and creates or updates the Apps Script deployment.

For security, Google OAuth data is never committed to the repository. The workflow reads these GitHub Actions secrets:

- `APPS_SCRIPT_ID` — target Apps Script Script ID
- `CLASPRC_JSON` — the authorized Google `~/.clasprc.json` contents
- `APPS_SCRIPT_DEPLOYMENT_ID` — optional; set this to update an existing production deployment instead of creating a new one

## Link locally with clasp

1. Install Node.js 18+.
2. Clone this repository.
3. Run `npm install`.
4. Run `npm run login` and sign in to the Google account that owns the Apps Script project.
5. Copy `.clasp.example.json` to `.clasp.json`.
6. Replace `PASTE_YOUR_GOOGLE_APPS_SCRIPT_ID_HERE` with the Script ID from **Apps Script → Project Settings → Script ID**.
7. Run `npm run push:force`.

Useful commands:

```bash
npm run push
npm run push:force
npm run pull
npm run open
npm run deployments
npm run deploy
```

## First-time Apps Script setup

After the source has been pushed to Apps Script:

1. Open the Apps Script editor.
2. Run `setupSystem()` once.
3. Accept the required Google permissions.
4. Check the execution log for the temporary Super Administrator password if one was created.
5. Run `runFullAuditAndRepairFromEditor()` to initialize/repair the production data structure and produce the audit report.
6. Deploy the project as a **Web app** using the deployment settings represented by `appsscript.json`.

## Web app routes

- Public site: deployed `/exec` URL
- Member: `/exec?page=member`
- Admin: `/exec?page=admin`

## Security

`.clasp.json`, `.clasprc.json`, OAuth tokens, passwords and Google credentials must not be committed. The deployment workflow writes OAuth material only to the temporary GitHub Actions runner and removes it after the run.

## Source recovery

The `.source/` directory contains the verified compressed source bundle parts used by the restore workflow. `.source/READY` records the verified source-bundle SHA-256. The restore workflow recreates the canonical `Code.gs`, `Index.html`, `Member.html`, and `Admin.html` files from that bundle.
