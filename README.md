# Atollo

Google Apps Script marketplace web application prepared for GitHub + `clasp` development.

## Project files

- `Code.gs` — Google Apps Script backend
- `Index.html` — public marketplace website
- `Member.html` — member login/dashboard
- `Admin.html` — administrator login/dashboard
- `appsscript.json` — Apps Script manifest

The repository also includes Node/`clasp` helper files so the project can be linked to an existing Google Apps Script project and pushed from a local computer or GitHub workflow.

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

## Link this repository to Google Apps Script

1. Install Node.js 18+.
2. Clone this repository.
3. Run `npm install`.
4. Run `npm run login` and sign in to the Google account that owns the Apps Script project.
5. Copy `.clasp.example.json` to `.clasp.json`.
6. Replace `PASTE_YOUR_GOOGLE_APPS_SCRIPT_ID_HERE` with the Script ID from **Apps Script → Project Settings → Script ID**.
7. Run `npm run push`.

Useful commands:

```bash
npm run push
npm run pull
npm run open
npm run deployments
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

## Security note

`.clasp.json` is intentionally ignored because it contains the Google Apps Script Script ID for the linked project. Do not commit private tokens, passwords, OAuth client secrets, service-account keys, or other credentials to this repository.

## Source recovery helper

`.source/atollo-source.tar.xz.b64` is a compressed backup of the four supplied Apps Script source files. The repository workflow restores the canonical `Code.gs`, `Index.html`, `Member.html`, and `Admin.html` files when that source bundle changes.
