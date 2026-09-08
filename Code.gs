/**
 * MV Market - Production Google Apps Script backend
 * Customer accounts, memberships, packages, payment-slip approval and admin console.
 */
const BACKEND_VERSION = '2026.07.16-full-device-responsive-audit-v7';

const APP = Object.freeze({
  DB_PROP: 'MV_MARKET_DB_ID',
  ROOT_FOLDER_PROP: 'MV_MARKET_ROOT_FOLDER_ID',
  SECRET_PROP: 'MV_MARKET_SECRET',
  SUPER_ADMIN_EMAIL: 'hashansoysa92@gmail.com',
  ADMIN_SESSION_HOURS: 12,
  MEMBER_SESSION_HOURS: 72,
  MAX_FAILED_LOGINS: 5,
  LOCK_MINUTES: 20,
  MAX_SLIP_BYTES: 5 * 1024 * 1024,
  MAX_AD_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_LOGO_BYTES: 2 * 1024 * 1024,
  LOGO_FILE_PROP: 'MV_MARKET_LOGO_FILE_ID',
  LOGO_NAME_PROP: 'MV_MARKET_LOGO_FILE_NAME',
  LOGO_MIME_PROP: 'MV_MARKET_LOGO_MIME',
  PUBLIC_CACHE_VERSION_PROP: 'MV_MARKET_PUBLIC_CACHE_VERSION',
  PUBLIC_CACHE_SECONDS: 90,
  PUBLIC_PAGE_SIZE: 24,
  PUBLIC_MAX_PAGE_SIZE: 48,
  ADMIN_LISTING_PAGE_SIZE: 60,
  MEMBER_PAGE_SIZE: 25
});

const SHEMAS = Object.freeze({
  Settings: ['Key','Value','Type'],
  Admins: ['Id','Name','Email','Role','Permissions','PasswordSalt','PasswordHash','MustChangePassword','Status','FailedAttempts','LockUntil','LastLogin','CreatedAt','UpdatedAt'],
  AdminSessions: ['TokenHash','AdminId','ExpiresAt','CreatedAt'],
  Members: ['Id','MembershipNumber','Name','Email','Phone','WhatsApp','AccountType','PasswordSalt','PasswordHash','Status','Verified','PackageId','Package','PackageStart','PackageExpiry','PostLimit','CreatedAt','UpdatedAt','LastLogin','FailedAttempts','LockUntil'],
  MemberSessions: ['TokenHash','MemberId','ExpiresAt','CreatedAt'],
  Categories: ['Id','Name','Icon','DisplayOrder','Status','CreatedAt','UpdatedAt'],
  Packages: ['Id','Name','Price','Posts','ValidityDays','Description','Recommended','DisplayOrder','Status','CreatedAt','UpdatedAt'],
  Advertisements: ['Id','Reference','MemberId','MembershipNumber','Title','Category','Location','Price','Currency','Condition','Seller','Phone','Description','Image','ImageFileId','ImageResourceKey','ImageName','ImageMimeType','ImageSize','Status','RejectionReason','Verified','Featured','CreatedAt','UpdatedAt','Date'],
  Payments: ['Id','Reference','MemberId','MembershipNumber','MemberName','PackageId','PackageName','Amount','Currency','Method','TransactionReference','ProofFileId','ProofUrl','Status','AdminNote','CreatedAt','UpdatedAt','ApprovedAt'],
  AuditLogs: ['Id','AdminName','AdminEmail','Action','Entity','RecordId','PreviousValue','NewValue','CreatedAt'],
  Counters: ['Key','Value']
});

const ALL_PERMISSIONS = Object.freeze([
  'dashboard.view','listings.view','listings.edit','listings.approve','listings.delete',
  'categories.manage','packages.manage','members.manage','payments.manage',
  'settings.manage','admins.manage','audit.view'
]);

const ROLE_PERMISSIONS = Object.freeze({
  'Super Administrator': ALL_PERMISSIONS.slice(),
  'Content Moderator': ['dashboard.view','listings.view','listings.edit','listings.approve','categories.manage'],
  'Payment Manager': ['dashboard.view','payments.manage','members.manage'],
  'Member Manager': ['dashboard.view','members.manage'],
  'Advertisement Moderator': ['dashboard.view','listings.view','listings.edit','listings.approve'],
  'Finance Administrator': ['dashboard.view','payments.manage','members.manage','audit.view'],
  'Customer Support Administrator': ['dashboard.view','listings.view','members.manage']
});

const LISTING_STATUSES = Object.freeze(['Draft','Pending Payment','Payment Submitted','Payment Confirmed','Pending Admin Approval','Published','Rejected','Expired','Closed','Unpublished']);
const PAYMENT_STATUSES = Object.freeze(['Pending','Submitted','Processing','Paid','Failed','Rejected','Refunded','Partially Refunded','Cancelled']);
const MEMBER_STATUSES = Object.freeze(['Active','Suspended','Deleted']);
const ADMIN_STATUSES = Object.freeze(['Active','Inactive']);
const ACCOUNT_TYPES = Object.freeze(['Individual','Business','Employer','Recruitment Agency','Property Agent','Service Provider']);
const CURRENCIES = Object.freeze(['MVR','USD']);
const ITEM_CONDITIONS = Object.freeze(['Brand New','Like New','Used','Refurbished','For Parts','Not Applicable']);

/**
 * Explicit route resolver. An empty, missing, unknown or `home` page always
 * resolves to the public homepage. Admin and member pages are opt-in only.
 */
function resolvePageFile_(e) {
  const raw = String((e && e.parameter && e.parameter.page) || (e && e.pathInfo) || '').trim().replace(/^\/+|\/+$/g,'').toLowerCase();
  if (raw === 'admin' || raw === 'administrator') return 'Admin';
  if (raw === 'member' || raw === 'account') return 'Member';
  return 'Index';
}

function getWebAppBaseUrl_() {
  return String(ScriptApp.getService().getUrl() || '').split('?')[0].split('#')[0];
}

function getTemplateBrandSnapshot_() {
  const fallback = {
    siteName: 'Website',
    shortName: 'Website',
    mark: 'W',
    description: 'Maldives classifieds marketplace.'
  };
  try {
    if (!isInitialized_()) return fallback;
    const settings = settingsMap_();
    const siteName = clean_(settings.siteName || settings.shortName || fallback.siteName, 120) || fallback.siteName;
    const shortName = clean_(settings.shortName || siteName, 80) || siteName;
    const description = clean_(settings.homeDescription || settings.footerText || fallback.description, 300) || fallback.description;
    return { siteName:siteName, shortName:shortName, mark:brandMark_(shortName || siteName), description:description };
  } catch (error) {
    console.warn('Template brand fallback used: ' + errorMessage_(error));
    return fallback;
  }
}

function brandMark_(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0,2).map(function(word){ return word.charAt(0); }).join('').toUpperCase().slice(0,2) || 'W');
}

function pageMetaFor_(file, brand) {
  const siteName = clean_((brand && brand.siteName) || 'Website', 120) || 'Website';
  if (file === 'Admin') return { title:siteName + ' Admin', description:'Secure administrator access for ' + siteName + '.' };
  if (file === 'Member') return { title:siteName + ' Member', description:'Member account and advertisement management for ' + siteName + '.' };
  return { title:siteName + ' | Maldives Classifieds', description:clean_((brand && brand.description) || 'Maldives classifieds marketplace.', 300) };
}

function doGet(e) {
  const file = resolvePageFile_(e);
  const initialBrand = getTemplateBrandSnapshot_();
  const meta = pageMetaFor_(file, initialBrand);
  const template = HtmlService.createTemplateFromFile(file);
  template.webAppUrl = getWebAppBaseUrl_();
  template.currentPage = file === 'Admin' ? 'admin' : file === 'Member' ? 'member' : 'home';
  template.initialBrand = initialBrand;
  template.pageTitle = meta.title;
  template.pageDescription = meta.description;
  return template.evaluate()
    .setTitle(meta.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Run from the Apps Script editor after deployment to verify the page-disappearing fix. */
function auditPageVisibilityFixFromEditor() {
  const brand = getTemplateBrandSnapshot_();
  const files = ['Index','Member','Admin'];
  const pages = files.map(function(file) {
    const meta = pageMetaFor_(file, brand);
    const template = HtmlService.createTemplateFromFile(file);
    template.webAppUrl = getWebAppBaseUrl_();
    template.currentPage = file === 'Admin' ? 'admin' : file === 'Member' ? 'member' : 'home';
    template.initialBrand = brand;
    template.pageTitle = meta.title;
    template.pageDescription = meta.description;
    const html = template.evaluate().getContent();
    const destructiveRootAttribute = /<html[^>]*\sdata-site-name\s*=/i.test(html);
    const safeInitialAttribute = /<html[^>]*\sdata-initial-site-name\s*=/i.test(html);
    return {
      page:file,
      ok:html.indexOf('<body') >= 0 && !destructiveRootAttribute && safeInitialAttribute,
      hasBody:html.indexOf('<body') >= 0,
      destructiveRootAttribute:destructiveRootAttribute,
      safeInitialAttribute:safeInitialAttribute,
      title:meta.title,
      renderedBytes:html.length
    };
  });
  const report = {
    ok:pages.every(function(page){ return page.ok; }),
    backendVersion:BACKEND_VERSION,
    siteName:brand.siteName,
    generatedAt:nowIso_(),
    pages:pages
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

/** Run once from the Apps Script editor. */
function setupSystem() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty(APP.SECRET_PROP)) props.setProperty(APP.SECRET_PROP, randomToken_(48));
    const ss = getDb_(true);
    Object.keys(SHEMAS).forEach(name => ensureSheet_(ss, name, SHEMAS[name]));
    ensureFolders_();
    seedSettings_();
    seedCategories_();
    seedCounters_();
    repairCounters_();
    migrateApprovedListingsToPublished_();
    repairAdvertisementImages_();
    scrubAuditLogs_();
    purgeExpiredSessions_();
    const temp = ensureSuperAdmin_(false);
    Logger.log('Database: ' + ss.getUrl());
    if (temp) Logger.log('TEMPORARY SUPER ADMIN PASSWORD: ' + temp);
    return { ok: true, databaseUrl: ss.getUrl(), superAdminEmail: APP.SUPER_ADMIN_EMAIL, temporaryPassword: temp || '' };
  } finally { lock.releaseLock(); }
}

function migrateToProductionFromEditor() { return setupSystem(); }


/** Run this once after replacing the project files. It repairs safe issues and logs a full audit report. */
function runFullAuditAndRepairFromEditor() {
  setupSystem();
  const report = buildSystemAudit_();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * One-step recovery for the complete production system.
 * Existing members, advertisements, payments and settings are preserved.
 * The Super Admin password is reset only when credentials are missing/broken.
 */
function repairEntireSystemFromEditor() {
  const result = { ok:false, backendVersion:BACKEND_VERSION, temporaryPassword:'', steps:{}, audit:null };
  result.steps.setup = setupSystem();
  let login = diagnoseAdminLoginFromEditor();
  if (!login.ok) {
    const recovery = repairSuperAdminLoginFromEditor();
    result.temporaryPassword = recovery.temporaryPassword || '';
    result.steps.adminRecovery = recovery;
    login = diagnoseAdminLoginFromEditor();
  }
  result.steps.login = login;
  result.steps.dashboard = diagnoseAdminDashboardFromEditor();
  result.audit = buildSystemAudit_();
  result.ok = !!(login.ok && result.steps.dashboard.ok && result.audit.ok);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Super Administrator dashboard audit action. */
function runSystemAudit(token) {
  requirePermission_(token,'audit.view');
  repairCounters_();
  migrateApprovedListingsToPublished_();
  repairAdvertisementImages_();
  scrubAuditLogs_();
  purgeExpiredSessions_();
  return buildSystemAudit_();
}

function buildSystemAudit_() {
  assertInitialized_();
  const checks = [];
  const add = (name,ok,details,severity) => checks.push({ name:name, ok:!!ok, severity:ok?'ok':(severity||'warning'), details:String(details||'') });
  add('Default Web App route', resolvePageFile_({parameter:{}}) === 'Index', 'Base /exec URL resolves to Index (Home).','critical');
  add('Admin route', resolvePageFile_({parameter:{page:'admin'}}) === 'Admin', '?page=admin resolves to Admin.','critical');
  add('Member route', resolvePageFile_({parameter:{page:'member'}}) === 'Member', '?page=member resolves to Member.','critical');

  try {
    const publicBootstrap = getPublicBootstrap();
    add('Public homepage bootstrap', !!publicBootstrap.initialized && Array.isArray(publicBootstrap.listings) && Array.isArray(publicBootstrap.categories), 'Homepage data, categories and listings are available.','critical');
    add('Truthful freshness signals', Number.isFinite(Number(publicBootstrap.stats && publicBootstrap.stats.newLast7Days)) && typeof (publicBootstrap.stats && publicBootstrap.stats.latestPublishedAt) === 'string', 'Freshness is calculated from real published listing dates.','warning');
    const samplePublicId = publicBootstrap.listings && publicBootstrap.listings[0] ? Number(publicBootstrap.listings[0].id) : 0;
    const directLookup = samplePublicId ? getPublicListingsByIds([samplePublicId]) : [];
    add('Saved/recent/direct listing lookup', !samplePublicId || (directLookup.length === 1 && Number(directLookup[0].id) === samplePublicId), samplePublicId ? 'Published listing lookup succeeded.' : 'No published listing is available for a lookup test.','warning');
  } catch (publicError) {
    add('Public homepage bootstrap', false, errorMessage_(publicError),'critical');
  }

  responsiveTemplateAudit_().forEach(function(page) {
    add('Responsive template: ' + page.file, page.ok, page.details, page.ok ? 'ok' : 'warning');
  });

  Object.keys(SHEMAS).forEach(name => {
    const sh = sheet_(name);
    const actual = sh.getRange(1,1,1,SHEMAS[name].length).getValues()[0].map(String);
    add('Sheet schema: ' + name, SHEMAS[name].every((h,i)=>actual[i]===h), actual.join(', '),'critical');
  });

  const admins = rows_('Admins'), members = rows_('Members'), ads = rows_('Advertisements'), payments = rows_('Payments'), categories = rows_('Categories'), packages = rows_('Packages');
  const superAdmin = admins.find(x => normalizeEmail_(x.Email) === normalizeEmail_(APP.SUPER_ADMIN_EMAIL));
  add('Primary Super Administrator', !!superAdmin && superAdmin.Role === 'Super Administrator' && superAdmin.Status === 'Active', superAdmin ? superAdmin.Email + ' / ' + superAdmin.Status : 'Missing','critical');

  if (superAdmin) {
    try {
      const auditAdmin = Object.assign({}, superAdmin, { MustChangePassword:false });
      const dashboardPayload = buildAdminBootstrap_(auditAdmin, []);
      const dashboardJson = JSON.stringify(dashboardPayload);
      add('Administrator dashboard bootstrap', !!dashboardPayload.admin && !!dashboardPayload.stats, dashboardJson.length + ' serialized bytes','critical');
      add('Administrator dashboard payload size', dashboardJson.length < 3000000, dashboardJson.length + ' bytes (recommended below 3,000,000)','warning');
      add('Administrator dashboard load warnings', !(dashboardPayload.warnings||[]).length, (dashboardPayload.warnings||[]).join(' | ') || 'No bootstrap warnings','warning');
    } catch (dashboardError) {
      add('Administrator dashboard bootstrap', false, errorMessage_(dashboardError),'critical');
    }
  } else {
    add('Administrator dashboard bootstrap', false, 'Primary Super Administrator is missing.','critical');
  }

  const duplicateValues = (items,selector) => {
    const counts = {}; items.forEach(x=>{const k=selector(x);if(k)counts[k]=(counts[k]||0)+1;});
    return Object.keys(counts).filter(k=>counts[k]>1);
  };
  const duplicateAdminEmails = duplicateValues(admins,x=>normalizeEmail_(x.Email));
  const duplicateMemberEmails = duplicateValues(members.filter(x=>x.Status!=='Deleted'),x=>normalizeEmail_(x.Email));
  const duplicateMemberships = duplicateValues(members,x=>String(x.MembershipNumber||'').trim());
  const duplicateAdRefs = duplicateValues(ads,x=>String(x.Reference||'').trim());
  const duplicatePaymentRefs = duplicateValues(payments,x=>String(x.Reference||'').trim());
  add('Unique administrator emails', !duplicateAdminEmails.length, duplicateAdminEmails.join(', ') || 'No duplicates','critical');
  add('Unique active member emails', !duplicateMemberEmails.length, duplicateMemberEmails.join(', ') || 'No duplicates','critical');
  add('Unique membership numbers', !duplicateMemberships.length, duplicateMemberships.join(', ') || 'No duplicates','critical');
  add('Unique advertisement references', !duplicateAdRefs.length, duplicateAdRefs.join(', ') || 'No duplicates','critical');
  add('Unique payment references', !duplicatePaymentRefs.length, duplicatePaymentRefs.join(', ') || 'No duplicates','critical');

  const memberIds = new Set(members.map(x=>Number(x.Id)));
  const packageIds = new Set(packages.map(x=>Number(x.Id)));
  const orphanAds = ads.filter(x=>x.MemberId && !memberIds.has(Number(x.MemberId))).map(x=>x.Reference);
  const orphanPayments = payments.filter(x=>x.MemberId && !memberIds.has(Number(x.MemberId))).map(x=>x.Reference);
  const missingPaymentPackages = payments.filter(x=>x.PackageId && !packageIds.has(Number(x.PackageId))).map(x=>x.Reference);
  add('Advertisement member links', !orphanAds.length, orphanAds.join(', ') || 'All linked records valid','warning');
  add('Payment member links', !orphanPayments.length, orphanPayments.join(', ') || 'All linked records valid','warning');
  add('Payment package links', !missingPaymentPackages.length, missingPaymentPackages.join(', ') || 'All linked records valid','warning');

  const invalidListingStatuses = ads.filter(x=>!LISTING_STATUSES.includes(String(x.Status||''))).map(x=>x.Reference + ': ' + x.Status);
  const invalidPaymentStatuses = payments.filter(x=>!PAYMENT_STATUSES.includes(String(x.Status||''))).map(x=>x.Reference + ': ' + x.Status);
  add('Advertisement statuses', !invalidListingStatuses.length, invalidListingStatuses.join(', ') || 'All statuses valid','warning');
  add('Payment statuses', !invalidPaymentStatuses.length, invalidPaymentStatuses.join(', ') || 'All statuses valid','warning');
  add('Active categories', categories.some(x=>x.Status==='Active'), categories.filter(x=>x.Status==='Active').length + ' active','warning');
  add('Active packages', packages.some(x=>x.Status==='Active'), packages.filter(x=>x.Status==='Active').length + ' active','warning');
  add('Published homepage listings', true, ads.filter(x=>String(x.Status)==='Published').length + ' published');

  const requiredSettings = ['siteName','companyEmail','registrationEnabled','postingEnabled','bankName','bankAccountName','bankAccountNumber'];
  const settings = settingsMap_();
  const missingSettings = requiredSettings.filter(k=>settings[k]===undefined);
  add('Required website settings', !missingSettings.length, missingSettings.join(', ') || 'All required settings exist','warning');

  let foldersOk = true, folderDetails = [];
  ['Website Logo','Payment Slips','Advertisement Images','Member Documents','Invoices','Receipts'].forEach(name=>{try{const f=getFolder_(name);folderDetails.push(name+': '+f.getId());}catch(e){foldersOk=false;folderDetails.push(name+': '+e.message);}});
  add('Google Drive folders', foldersOk, folderDetails.join(' | '),'critical');

  const categoryNames = new Set(categories.map(x=>String(x.Name||'')));
  const brokenAdCategories = ads.filter(x=>x.Category && !categoryNames.has(String(x.Category))).map(x=>x.Reference + ': ' + x.Category);
  const invalidAds = ads.filter(x=>!x.Title || !x.Category || !x.Location || !Number.isFinite(Number(x.Price))).map(x=>x.Reference || x.Id);
  const invalidMemberPackages = members.filter(x=>x.PackageId && !packageIds.has(Number(x.PackageId))).map(x=>x.MembershipNumber);
  const duplicateTransactions = duplicateValues(payments.filter(x=>!['Rejected','Failed','Cancelled'].includes(String(x.Status||''))),x=>String(x.TransactionReference||'').trim().toLowerCase());
  add('Advertisement category links', !brokenAdCategories.length, brokenAdCategories.join(', ') || 'All categories valid','warning');
  add('Advertisement required fields', !invalidAds.length, invalidAds.join(', ') || 'All required fields valid','warning');
  add('Member package links', !invalidMemberPackages.length, invalidMemberPackages.join(', ') || 'All package assignments valid','warning');
  add('Unique active transaction references', !duplicateTransactions.length, duplicateTransactions.join(', ') || 'No duplicates','critical');

  const imageProblems = [], missingPublishedImages = [];
  ads.forEach(function(ad) {
    if (String(ad.Status||'') === 'Published' && !ad.ImageFileId && !ad.Image) missingPublishedImages.push(ad.Reference);
    if (!ad.ImageFileId) return;
    try {
      const file = DriveApp.getFileById(String(ad.ImageFileId));
      const mime = String(file.getMimeType()||'').toLowerCase();
      if (!['image/jpeg','image/png','image/webp'].includes(mime)) imageProblems.push(ad.Reference + ': ' + mime);
      if (Number(file.getSize()||0) <= 0 || Number(file.getSize()||0) > APP.MAX_AD_IMAGE_BYTES) imageProblems.push(ad.Reference + ': invalid image size');
      try {
        const access = file.getSharingAccess();
        if (access !== DriveApp.Access.ANYONE_WITH_LINK && access !== DriveApp.Access.ANYONE) imageProblems.push(ad.Reference + ': image is not publicly viewable');
      } catch (sharingError) { imageProblems.push(ad.Reference + ': image sharing could not be verified'); }
    } catch (error) { imageProblems.push(ad.Reference + ': missing Drive image'); }
  });
  add('Advertisement image files', !imageProblems.length, imageProblems.join(', ') || 'All uploaded images are available','warning');
  add('Published advertisement images', !missingPublishedImages.length, missingPublishedImages.join(', ') || 'All published advertisements have an image','warning');

  const proofProblems = [];
  payments.filter(x=>x.ProofFileId).forEach(function(payment) {
    try {
      const file = DriveApp.getFileById(String(payment.ProofFileId));
      if (Number(file.getSize()||0) <= 0 || Number(file.getSize()||0) > APP.MAX_SLIP_BYTES) proofProblems.push(payment.Reference + ': invalid proof size');
      try {
        const access = file.getSharingAccess();
        if (access === DriveApp.Access.ANYONE_WITH_LINK || access === DriveApp.Access.ANYONE) proofProblems.push(payment.Reference + ': payment proof must remain private');
      } catch (sharingError) {}
    } catch (error) { proofProblems.push(payment.Reference + ': missing payment proof'); }
  });
  add('Payment proof files', !proofProblems.length, proofProblems.join(', ') || 'All payment proofs are available','warning');

  const invalidSessions = rows_('AdminSessions').concat(rows_('MemberSessions')).filter(x=>!x.ExpiresAt || isNaN(new Date(x.ExpiresAt).getTime())).length;
  add('Session expiry data', invalidSessions === 0, invalidSessions ? invalidSessions + ' invalid session record(s)' : 'All sessions have valid expiry times','warning');

  const exposedAuditSecrets = rows_('AuditLogs').filter(function(log) {
    return auditTextContainsSecret_(log.PreviousValue) || auditTextContainsSecret_(log.NewValue);
  });
  add('Audit log credential redaction', !exposedAuditSecrets.length, exposedAuditSecrets.length ? exposedAuditSecrets.length + ' log record(s) require redaction' : 'No password, salt or session-token values are exposed','critical');

  const critical = checks.filter(x=>!x.ok&&x.severity==='critical').length;
  const warnings = checks.filter(x=>!x.ok&&x.severity==='warning').length;
  return {
    ok: critical === 0,
    generatedAt: nowIso_(),
    canonicalHomeUrl: getWebAppBaseUrl_() ? getWebAppBaseUrl_() + '?page=home' : '',
    summary: { critical:critical, warnings:warnings, checks:checks.length },
    counts: { admins:admins.length, members:members.length, advertisements:ads.length, published:ads.filter(x=>x.Status==='Published').length, payments:payments.length, categories:categories.length, packages:packages.length },
    checks:checks
  };
}

/** Run after deployment to verify the ethical discovery and return-visitor upgrade. */
function auditPublicDiscoveryUpgradeFromEditor() {
  setupSystem();
  const bootstrap = getPublicBootstrap();
  const sampleId = bootstrap.listings && bootstrap.listings[0] ? Number(bootstrap.listings[0].id) : 0;
  const lookup = sampleId ? getPublicListingsByIds([sampleId]) : [];
  const report = {
    ok: !!(bootstrap.initialized && Array.isArray(bootstrap.categories) && Array.isArray(bootstrap.listings) && (!sampleId || lookup.length === 1)),
    backendVersion: BACKEND_VERSION,
    generatedAt: nowIso_(),
    publicCounts: {
      listings: Number(bootstrap.stats && bootstrap.stats.publishedListings || 0),
      verifiedSellers: Number(bootstrap.stats && bootstrap.stats.verifiedSellers || 0),
      newLast7Days: Number(bootstrap.stats && bootstrap.stats.newLast7Days || 0)
    },
    latestPublishedAt: String(bootstrap.stats && bootstrap.stats.latestPublishedAt || ''),
    directListingLookup: sampleId ? { requestedId:sampleId, returned:lookup.length } : { requestedId:0, returned:0, note:'No published listing available.' }
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}



/** Static, deployment-safe responsive checks for all three HTML surfaces. */
function responsiveTemplateAudit_() {
  return ['Index','Member','Admin'].map(function(file) {
    let html = '';
    try { html = HtmlService.createHtmlOutputFromFile(file).getContent(); }
    catch (error) { return { file:file, ok:false, details:'Could not read template: ' + errorMessage_(error) }; }
    const checks = {
      viewport: /name=["']viewport["'][^>]*viewport-fit=cover/i.test(html),
      mediaQueries: (html.match(/@media\s*\(/g) || []).length >= 3,
      dynamicViewport: /100dvh|dvh\s*-/i.test(html),
      safeArea: /safe-area-inset-(top|right|bottom|left)/i.test(html),
      touchTargets: /min-height\s*:\s*(44|45|46|48)px/i.test(html),
      overflowProtection: /overflow-x\s*:\s*hidden|overflow-wrap\s*:\s*anywhere/i.test(html)
    };
    if (file !== 'Index') checks.responsiveTables = /Responsive tables|responsive-empty-cell/i.test(html);
    if (file === 'Admin') checks.mobileNavigationBackdrop = /sidebar-backdrop/i.test(html);
    const failed = Object.keys(checks).filter(function(key){ return !checks[key]; });
    return {
      file:file,
      ok:failed.length === 0,
      checks:checks,
      details:failed.length ? 'Missing: ' + failed.join(', ') : 'Viewport-fit, dynamic viewport, safe areas, touch targets and narrow-screen layouts are present.'
    };
  });
}

/** Run from the editor after replacing the files to verify responsive safeguards. */
function auditResponsiveCompatibilityFromEditor() {
  const pages = responsiveTemplateAudit_();
  const report = {
    ok:pages.every(function(page){ return page.ok; }),
    backendVersion:BACKEND_VERSION,
    generatedAt:nowIso_(),
    testedProfiles:[
      'Small phone 320-374px','Modern phone 375-479px','Large phone 480-699px',
      'Tablet portrait 700-950px','Tablet/compact laptop 951-1200px','Desktop 1201px+',
      'Landscape low-height screens','Touch/coarse-pointer devices','Reduced-motion preference'
    ],
    pages:pages
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Run from the Apps Script editor to verify Drive authorization and the Payment Slips folder. */
function testPaymentSlipStorageFromEditor() {
  setupSystem();
  const folder = getFolder_('Payment Slips');
  const blob = Utilities.newBlob('MV Market payment-slip storage test', 'text/plain', 'payment-slip-storage-test.txt');
  const file = folder.createFile(blob);
  const result = { ok:true, folderId:folder.getId(), folderUrl:folder.getUrl(), testFileId:file.getId() };
  file.setTrashed(true);
  Logger.log(JSON.stringify(result));
  return result;
}

function repairSuperAdminLoginFromEditor() {
  // Safe recovery: keeps all marketplace data, repairs only the primary Super Admin credentials.
  setupSystem();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(APP.SECRET_PROP)) props.setProperty(APP.SECRET_PROP, randomToken_(48));

  const email = normalizeEmail_(APP.SUPER_ADMIN_EMAIL);
  let matching = rows_('Admins').filter(x => normalizeEmail_(x.Email) === email).sort((a,b)=>Number(a.Id)-Number(b.Id));
  if (!matching.length) {
    const now = nowIso_();
    append_('Admins', {
      Id:nextCounter_('ADMIN_ID'), Name:'Super Administrator', Email:APP.SUPER_ADMIN_EMAIL,
      Role:'Super Administrator', Permissions:JSON.stringify(ALL_PERMISSIONS), PasswordSalt:'', PasswordHash:'',
      MustChangePassword:true, Status:'Active', FailedAttempts:0, LockUntil:'', LastLogin:'', CreatedAt:now, UpdatedAt:now
    });
    matching = rows_('Admins').filter(x => normalizeEmail_(x.Email) === email).sort((a,b)=>Number(a.Id)-Number(b.Id));
  }

  const admin = matching[0];
  // Duplicate primary-admin rows can make login/dashboard behaviour unpredictable. Keep the oldest and disable the rest.
  matching.slice(1).forEach(function(duplicate) {
    updateById_('Admins', duplicate.Id, { Status:'Inactive', UpdatedAt:nowIso_() });
    deleteSessionsFor_('AdminSessions','AdminId',duplicate.Id);
  });

  const password = generatePassword_();
  const creds = makePassword_(password);
  updateById_('Admins', admin.Id, {
    Name:'Super Administrator', Email:APP.SUPER_ADMIN_EMAIL, Role:'Super Administrator',
    Permissions:JSON.stringify(ALL_PERMISSIONS), PasswordSalt:creds.salt, PasswordHash:creds.hash,
    MustChangePassword:true, Status:'Active', FailedAttempts:0, LockUntil:'', UpdatedAt:nowIso_()
  });
  deleteSessionsFor_('AdminSessions', 'AdminId', admin.Id);

  const base = getWebAppBaseUrl_();
  const adminUrl = base ? base + '?page=admin' : '';
  const emailSent = trySend_(APP.SUPER_ADMIN_EMAIL, 'MV Market Super Admin temporary password',
    'Your temporary password is: ' + password + '\n\nAdmin login: ' + adminUrl + '\n\nChange it immediately after login.');
  Logger.log('BACKEND VERSION: ' + BACKEND_VERSION);
  Logger.log('SUPER ADMIN EMAIL: ' + APP.SUPER_ADMIN_EMAIL);
  Logger.log('TEMPORARY SUPER ADMIN PASSWORD: ' + password);
  Logger.log('ADMIN LOGIN URL: ' + adminUrl);
  return { ok:true, backendVersion:BACKEND_VERSION, email:APP.SUPER_ADMIN_EMAIL, temporaryPassword:password, adminUrl:adminUrl, emailSent:emailSent };
}

// Easier-to-find aliases for emergency recovery from the Apps Script editor.
function restoreAdminLoginFromEditor() { return repairSuperAdminLoginFromEditor(); }
function resetSuperAdminPasswordFromEditor() { return repairSuperAdminLoginFromEditor(); }

function diagnoseAdminLoginFromEditor() {
  const initialized = isInitialized_();
  const props = PropertiesService.getScriptProperties();
  let admin = null, adminCount = 0, adminsSheet = false, sessionsSheet = false;
  if (initialized) {
    try {
      adminsSheet = !!sheet_('Admins'); sessionsSheet = !!sheet_('AdminSessions');
      const matches = rows_('Admins').filter(x => normalizeEmail_(x.Email) === normalizeEmail_(APP.SUPER_ADMIN_EMAIL));
      adminCount = matches.length; admin = matches[0] || null;
    } catch (ignored) {}
  }
  const base = getWebAppBaseUrl_();
  const report = {
    ok:!!(initialized && props.getProperty(APP.SECRET_PROP) && adminsSheet && sessionsSheet && admin && admin.Status==='Active' && admin.PasswordSalt && admin.PasswordHash),
    backendVersion:BACKEND_VERSION,
    initialized:initialized,
    secretPresent:!!props.getProperty(APP.SECRET_PROP),
    databasePropertyPresent:!!props.getProperty(APP.DB_PROP),
    adminsSheet:adminsSheet,
    adminSessionsSheet:sessionsSheet,
    primaryAdminRows:adminCount,
    primaryAdminActive:!!(admin && admin.Status==='Active'),
    passwordCredentialsPresent:!!(admin && admin.PasswordSalt && admin.PasswordHash),
    accountLockedUntil:admin ? String(admin.LockUntil||'') : '',
    mustChangePassword:admin ? bool_(admin.MustChangePassword) : false,
    homeUrl:base || '',
    adminUrl:base ? base + '?page=admin' : ''
  };
  Logger.log(JSON.stringify(report,null,2));
  return report;
}

function getSystemStatus() {
  const initialized = isInitialized_();
  let loginReady = false, repairRequired = false;
  if (initialized) {
    try {
      const admin = rows_('Admins').find(x => normalizeEmail_(x.Email) === normalizeEmail_(APP.SUPER_ADMIN_EMAIL));
      loginReady = !!(PropertiesService.getScriptProperties().getProperty(APP.SECRET_PROP) && admin && admin.Status === 'Active' && admin.PasswordSalt && admin.PasswordHash);
      repairRequired = !loginReady;
    } catch (ignored) { repairRequired = true; }
  }
  return {
    initialized:initialized, loginReady:loginReady, repairRequired:repairRequired,
    backendVersion:BACKEND_VERSION, superAdminEmail:APP.SUPER_ADMIN_EMAIL,
    brand:initialized ? brandPayload_() : defaultBrandPayload_()
  };
}

/** Public brand data used by the website, member login and administrator login. */
function getWebsiteBrand() {
  return isInitialized_() ? brandPayload_() : defaultBrandPayload_();
}

// ---------- Public ----------
function getPublicBootstrap() {
  if (!isInitialized_()) return { initialized:false };
  const version = publicCacheVersion_();
  const cacheKey = 'PUBLIC_BOOTSTRAP_' + version;
  const cached = cacheJsonGet_(cacheKey);
  if (cached) return cached;

  const settings = settingsMap_();
  const cats = rows_('Categories').filter(x => x.Status === 'Active').sort(orderSort_);
  const allAds = rows_('Advertisements');
  const published = publicPublishedRows_(allAds);
  const counts = {};
  published.forEach(x => counts[x.Category] = (counts[x.Category] || 0) + 1);
  const listingPage = buildPublicListingsPage_(published, {page:1,pageSize:APP.PUBLIC_PAGE_SIZE,sort:'newest'});
  const result = {
    initialized:true,
    settings:publicSettings_(settings),
    categories:cats.map(x => ({id:Number(x.Id),name:x.Name,icon:x.Icon,count:counts[x.Name] || 0})),
    packages:rows_('Packages').filter(x => x.Status === 'Active').sort(orderSort_).map(publicPackage_),
    listings:listingPage.items,
    listingPage:listingPage,
    jobs:published.filter(x => String(x.Category || '').trim().toLowerCase() === 'jobs').sort((a,b)=>Number(b.Id)-Number(a.Id)).slice(0,6).map(publicListing_),
    locations:[...new Set(published.map(x=>String(x.Location||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),
    stats:{publishedListings:published.length,verifiedSellers:new Set(published.filter(x=>bool_(x.Verified)).map(x=>String(x.Seller||'').trim()).filter(Boolean)).size,newLast7Days:published.filter(x=>listingTimestamp_(x)>=Date.now()-7*86400000).length,latestPublishedAt:latestListingIso_(published)}
  };
  cacheJsonPut_(cacheKey, result, APP.PUBLIC_CACHE_SECONDS);
  return result;
}

/** Lightweight server-side listing pagination for the public website. */
function getPublicListingsPage(request) {
  assertInitialized_();
  request = request || {};
  const normalized = normalizePublicListingRequest_(request);
  const version = publicCacheVersion_();
  const cacheKey = 'PUBLIC_PAGE_' + version + '_' + shortHash_(JSON.stringify(normalized));
  const cached = cacheJsonGet_(cacheKey);
  if (cached) return cached;
  const result = buildPublicListingsPage_(publicPublishedRows_(rows_('Advertisements')), normalized);
  cacheJsonPut_(cacheKey, result, APP.PUBLIC_CACHE_SECONDS);
  return result;
}

/** Returns a bounded set of published listings for saved items, recent views and direct links. */
function getPublicListingsByIds(ids) {
  assertInitialized_();
  const requested = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(id => Number.isFinite(id) && id > 0))].slice(0,24);
  if (!requested.length) return [];
  const wanted = new Set(requested);
  const byId = {};
  publicPublishedRows_(rows_('Advertisements')).forEach(function(row) {
    const id = Number(row.Id);
    if (wanted.has(id)) byId[id] = publicListing_(row);
  });
  return requested.map(id => byId[id]).filter(Boolean);
}

function publicPublishedRows_(rows) {
  return (rows || []).filter(x => ['published','approved'].includes(String(x.Status || '').trim().toLowerCase()));
}

function normalizePublicListingRequest_(request) {
  request = request || {};
  const pageSize = Math.max(1, Math.min(APP.PUBLIC_MAX_PAGE_SIZE, Number(request.pageSize || APP.PUBLIC_PAGE_SIZE)));
  const sort = ['newest','priceLow','priceHigh'].includes(String(request.sort || 'newest')) ? String(request.sort || 'newest') : 'newest';
  const rawMaxPrice = request.maxPrice;
  const maxPriceRaw = rawMaxPrice === '' || rawMaxPrice === null || rawMaxPrice === undefined ? NaN : Number(rawMaxPrice);
  return {
    page:Math.max(1, Number(request.page || 1)),
    pageSize:pageSize,
    keyword:clean_(request.keyword,120).toLowerCase(),
    category:clean_(request.category,100),
    location:clean_(request.location,120),
    condition:clean_(request.condition,40),
    maxPrice:Number.isFinite(maxPriceRaw) && maxPriceRaw >= 0 ? maxPriceRaw : '',
    sort:sort
  };
}

function buildPublicListingsPage_(rows, request) {
  const q = normalizePublicListingRequest_(request);
  let filtered = (rows || []).filter(function(item) {
    const haystack = (String(item.Title || '') + ' ' + String(item.Seller || '') + ' ' + String(item.Description || '')).toLowerCase();
    return (!q.keyword || haystack.indexOf(q.keyword) !== -1) &&
      (!q.category || String(item.Category || '') === q.category) &&
      (!q.location || String(item.Location || '') === q.location) &&
      (!q.condition || String(item.Condition || '') === q.condition) &&
      (q.maxPrice === '' || Number(item.Price || 0) <= Number(q.maxPrice));
  });
  if (q.sort === 'priceLow') filtered.sort((a,b) => Number(a.Price || 0) - Number(b.Price || 0) || Number(b.Id)-Number(a.Id));
  else if (q.sort === 'priceHigh') filtered.sort((a,b) => Number(b.Price || 0) - Number(a.Price || 0) || Number(b.Id)-Number(a.Id));
  else filtered.sort((a,b) => Number(b.Id)-Number(a.Id));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, totalPages);
  const start = (page - 1) * q.pageSize;
  const items = filtered.slice(start, start + q.pageSize).map(publicListing_);
  return {items:items,total:total,page:page,pageSize:q.pageSize,totalPages:totalPages,hasMore:start + items.length < total};
}

function listingTimestamp_(row) {
  const raw = row && (row.CreatedAt || row.Date || row.UpdatedAt);
  const value = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}
function latestListingIso_(rows) {
  const timestamps = (rows || []).map(listingTimestamp_).filter(Boolean);
  return timestamps.length ? new Date(Math.max.apply(null,timestamps)).toISOString() : '';
}

function publicCacheVersion_() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty(APP.PUBLIC_CACHE_VERSION_PROP);
  if (!version) { version = String(Date.now()); props.setProperty(APP.PUBLIC_CACHE_VERSION_PROP, version); }
  return version;
}
function bumpPublicCacheVersion_() { PropertiesService.getScriptProperties().setProperty(APP.PUBLIC_CACHE_VERSION_PROP, String(Date.now())); }
function cacheJsonGet_(key) { try { const value=CacheService.getScriptCache().get(key); return value ? JSON.parse(value) : null; } catch (ignored) { return null; } }
function cacheJsonPut_(key,value,seconds) { try { const json=JSON.stringify(value); if (json.length < 95000) CacheService.getScriptCache().put(key,json,seconds || 60); } catch (ignored) {} }
function shortHash_(value) { try { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value))).replace(/=+$/,'').slice(0,24); } catch (ignored) { return String(value).length + '_' + Date.now(); } }


// Public posting is intentionally blocked. Members must authenticate.
function createPublicListing() { throw new Error('Please sign in to your member account before posting an advertisement.'); }

// ---------- Member authentication ----------
function memberSignup(data) {
  assertInitialized_();
  const settings = settingsMap_();
  if (!bool_(settings.registrationEnabled)) throw new Error('New member registration is currently disabled.');
  data = data || {};
  const name = clean_(data.name, 120), email = normalizeEmail_(data.email), phone = clean_(data.phone, 40);
  const whatsapp = clean_(data.whatsapp || data.phone, 40), accountType = clean_(data.accountType || 'Individual', 60);
  const password = String(data.password || '');
  if (name.length < 2) throw new Error('Enter your full name.');
  if (!validEmail_(email)) throw new Error('Enter a valid email address.');
  validatePassword_(password, false);
  if (!ACCOUNT_TYPES.includes(accountType)) throw new Error('Select a valid account type.');

  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (rows_('Members').some(x => normalizeEmail_(x.Email) === email && x.Status !== 'Deleted')) throw new Error('An account already exists with this email address.');
    const id = nextCounter_('MEMBER_ID');
    const membershipNumber = 'MVM-' + year_() + '-' + pad6_(nextCounter_('MEMBERSHIP'));
    const creds = makePassword_(password);
    append_('Members', {
      Id:id, MembershipNumber:membershipNumber, Name:name, Email:email, Phone:phone, WhatsApp:whatsapp,
      AccountType:accountType, PasswordSalt:creds.salt, PasswordHash:creds.hash, Status:'Active', Verified:false,
      PackageId:'', Package:'', PackageStart:'', PackageExpiry:'', PostLimit:0,
      CreatedAt:nowIso_(), UpdatedAt:nowIso_(), LastLogin:'', FailedAttempts:0, LockUntil:''
    });
    trySend_(email, 'Welcome to ' + (settings.siteName || 'MV Market'),
      'Your account has been created.\nMembership Number: ' + membershipNumber + '\n\nUse this number as your payment reference.');
    return { ok:true, membershipNumber:membershipNumber, message:'Account created successfully.' };
  } finally { lock.releaseLock(); }
}

function memberLogin(email, password) {
  assertInitialized_();
  email = normalizeEmail_(email);
  const member = rows_('Members').find(x => normalizeEmail_(x.Email) === email && x.Status !== 'Deleted');
  if (!member) throw new Error('Invalid email address or password.');
  if (member.Status !== 'Active') throw new Error('This member account is ' + String(member.Status || 'unavailable').toLowerCase() + '.');
  const now = Date.now();
  if (member.LockUntil && new Date(member.LockUntil).getTime() > now) throw new Error('Account temporarily locked. Try again later.');
  if (!verifyPassword_(String(password || ''), member.PasswordSalt, member.PasswordHash)) {
    const failed = Number(member.FailedAttempts || 0) + 1;
    const updates = { FailedAttempts:failed, UpdatedAt:nowIso_() };
    if (failed >= APP.MAX_FAILED_LOGINS) updates.LockUntil = new Date(now + APP.LOCK_MINUTES * 60000).toISOString();
    updateById_('Members', member.Id, updates);
    throw new Error(failed >= APP.MAX_FAILED_LOGINS ? 'Account temporarily locked after repeated failed attempts.' : 'Invalid email address or password.');
  }
  const token = createSession_('MemberSessions', 'MemberId', member.Id, APP.MEMBER_SESSION_HOURS);
  updateById_('Members', member.Id, { FailedAttempts:0, LockUntil:'', LastLogin:nowIso_(), UpdatedAt:nowIso_() });
  return { token:token, membershipNumber:member.MembershipNumber, name:member.Name };
}

function memberLogout(token) { removeSession_('MemberSessions', token); return true; }

function getMemberBootstrap(token) {
  const member = requireMember_(token);
  const settings = settingsMap_();
  const allListings = rows_('Advertisements').filter(x => Number(x.MemberId) === Number(member.Id)).sort((a,b)=>Number(b.Id)-Number(a.Id));
  const usage = memberUsageFromListings_(member, allListings);
  const allPayments = rows_('Payments').filter(x => Number(x.MemberId) === Number(member.Id)).sort((a,b)=>Number(b.Id)-Number(a.Id));
  const listingPage = buildMemberPage_(allListings, 1, APP.MEMBER_PAGE_SIZE, memberListing_);
  const paymentPage = buildMemberPage_(allPayments, 1, APP.MEMBER_PAGE_SIZE, memberPayment_);
  return {
    member:publicMember_(member, usage),
    packages:rows_('Packages').filter(x => x.Status === 'Active').sort(orderSort_).map(publicPackage_),
    categories:rows_('Categories').filter(x => x.Status === 'Active').sort(orderSort_).map(x => ({id:Number(x.Id),name:x.Name,icon:x.Icon})),
    listings:listingPage.items,
    payments:paymentPage.items,
    meta:{listingPage:listingPage,paymentPage:paymentPage},
    brand:brandPayload_(),
    paymentDetails:{
      bankName:settings.bankName || '', accountName:settings.bankAccountName || '', accountNumber:settings.bankAccountNumber || '',
      branch:settings.bankBranch || '', instructions:settings.paymentInstructions || '', companyPhone:settings.companyPhone || '',
      companyWhatsApp:settings.companyWhatsApp || '', currency:settings.defaultCurrency || 'MVR'
    },
    postingEnabled:bool_(settings.postingEnabled)
  };
}

function getMemberListingsPage(token, page, pageSize) {
  const member = requireMember_(token);
  const rows = rows_('Advertisements').filter(x => Number(x.MemberId) === Number(member.Id)).sort((a,b)=>Number(b.Id)-Number(a.Id));
  return buildMemberPage_(rows, page, pageSize, memberListing_);
}
function getMemberPaymentsPage(token, page, pageSize) {
  const member = requireMember_(token);
  const rows = rows_('Payments').filter(x => Number(x.MemberId) === Number(member.Id)).sort((a,b)=>Number(b.Id)-Number(a.Id));
  return buildMemberPage_(rows, page, pageSize, memberPayment_);
}
function buildMemberPage_(rows, page, pageSize, mapper) {
  const size = Math.max(1,Math.min(50,Number(pageSize || APP.MEMBER_PAGE_SIZE)));
  const total = (rows || []).length;
  const totalPages = Math.max(1,Math.ceil(total / size));
  const current = Math.min(Math.max(1,Number(page || 1)),totalPages);
  const start = (current - 1) * size;
  const items = (rows || []).slice(start,start + size).map(mapper);
  return {items:items,total:total,page:current,pageSize:size,totalPages:totalPages,hasMore:start + items.length < total};
}


function updateMemberProfile(token, data) {
  const member = requireMember_(token); data = data || {};
  const updates = {
    Name:clean_(data.name,120), Phone:clean_(data.phone,40), WhatsApp:clean_(data.whatsapp,40),
    AccountType:clean_(data.accountType || member.AccountType,60), UpdatedAt:nowIso_()
  };
  if (!updates.Name) throw new Error('Name is required.');
  if (!ACCOUNT_TYPES.includes(updates.AccountType)) throw new Error('Select a valid account type.');
  updateById_('Members', member.Id, updates);
  return { ok:true };
}

function changeMemberPassword(token, currentPassword, newPassword) {
  const member = requireMember_(token);
  if (!verifyPassword_(String(currentPassword || ''), member.PasswordSalt, member.PasswordHash)) throw new Error('Current password is incorrect.');
  validatePassword_(String(newPassword || ''), false);
  const creds = makePassword_(String(newPassword));
  updateById_('Members', member.Id, { PasswordSalt:creds.salt, PasswordHash:creds.hash, UpdatedAt:nowIso_() });
  deleteSessionsFor_('MemberSessions','MemberId',member.Id);
  return { ok:true };
}

/**
 * Native HTML form upload endpoint.
 * The payment form must be passed as the only google.script.run argument so
 * Apps Script converts the file input into a Blob without Base64 transport.
 */
function submitMemberPaymentForm(formObject) {
  formObject = formObject || {};
  const member = requireMember_(String(formObject.token || ''));
  const packageId = Number(formObject.packageId || 0);
  const transactionReference = clean_(formObject.transactionReference, 120);
  const optimizedUpload = clientCompressedImageBlob_(formObject.compressedSlipData, formObject.compressedSlipName, formObject.compressedSlipMime);
  const upload = optimizedUpload || formObject.slipFile;
  if (!upload || typeof upload.getBytes !== 'function') throw new Error('Select a payment slip before uploading.');
  const file = savePaymentSlipBlob_(member, upload);
  try {
    return createPaymentSubmission_(member, packageId, transactionReference, file);
  } catch (error) {
    // Do not leave an orphaned private Drive file when the database write fails.
    try { file.setTrashed(true); } catch (ignored) {}
    throw error;
  }
}

/** Legacy Base64 endpoint retained for older deployed Member.html versions. */
function submitMemberPayment(token, payload) {
  const member = requireMember_(token); payload = payload || {};
  const packageId = Number(payload.packageId || 0);
  const transactionReference = clean_(payload.transactionReference, 120);
  if (!payload.fileData || !payload.fileName) throw new Error('Upload the bank transfer slip.');
  const file = savePaymentSlip_(member, payload.fileData, payload.fileName, payload.mimeType || mimeFromFileName_(payload.fileName));
  try {
    return createPaymentSubmission_(member, packageId, transactionReference, file);
  } catch (error) {
    try { file.setTrashed(true); } catch (ignored) {}
    throw error;
  }
}

function createPaymentSubmission_(member, packageId, transactionReference, file) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const pack = rows_('Packages').find(x => Number(x.Id) === Number(packageId) && x.Status === 'Active');
    if (!pack) throw new Error('Please select a valid active package.');
    if (!transactionReference) throw new Error('Enter the bank transaction/reference number.');
    const duplicate = rows_('Payments').find(x =>
      Number(x.MemberId) === Number(member.Id) &&
      String(x.TransactionReference || '').trim().toLowerCase() === String(transactionReference).trim().toLowerCase() &&
      !['Rejected','Failed','Cancelled'].includes(String(x.Status || ''))
    );
    if (duplicate) throw new Error('This transaction/reference number has already been submitted as ' + duplicate.Reference + '.');
    const id = nextCounter_('PAYMENT_ID');
    const reference = 'PAY-' + year_() + '-' + pad6_(nextCounter_('PAYMENT_REF'));
    const currency = CURRENCIES.includes(String(settingsMap_().defaultCurrency || 'MVR')) ? String(settingsMap_().defaultCurrency || 'MVR') : 'MVR';
    append_('Payments', {
      Id:id, Reference:reference, MemberId:member.Id, MembershipNumber:member.MembershipNumber, MemberName:member.Name,
      PackageId:pack.Id, PackageName:pack.Name, Amount:Number(pack.Price||0), Currency:currency, Method:'Bank Transfer',
      TransactionReference:transactionReference, ProofFileId:file.getId(), ProofUrl:file.getUrl(), Status:'Submitted', AdminNote:'',
      CreatedAt:nowIso_(), UpdatedAt:nowIso_(), ApprovedAt:''
    });
    notifyAdmins_('New payment submitted', member.Name + ' (' + member.MembershipNumber + ') submitted ' + reference + ' for ' + pack.Name + '.');
    return { ok:true, reference:reference, fileName:file.getName() };
  } finally { lock.releaseLock(); }
}

/**
 * Native member advertisement form endpoint. The HTML form must be passed as
 * the only google.script.run parameter so Apps Script converts the selected
 * gallery/camera file input into a Blob.
 */
function submitMemberListingForm(formObject) {
  formObject = formObject || {};
  const member = requireMember_(String(formObject.token || ''));
  const payload = validateMemberListingPayload_(formObject);
  const optimizedUpload = clientCompressedImageBlob_(formObject.compressedImageData, formObject.compressedImageName, formObject.compressedImageMime);
  const upload = optimizedUpload || firstNonEmptyBlob_([formObject.galleryImage, formObject.cameraImage]);
  if (!upload) throw new Error('Select an item photo from your gallery or capture one with the camera.');

  const imageFile = saveAdvertisementImageBlob_(member, upload);
  try {
    return createMemberListingRecord_(member.Id, payload, imageFile);
  } catch (error) {
    try { imageFile.setTrashed(true); } catch (ignored) {}
    throw error;
  }
}

/** Legacy endpoint retained only to give older cached pages a clear upgrade message. */
function createMemberListing(token, payload) {
  requireMember_(token);
  throw new Error('This page is outdated. Refresh the Member Dashboard and upload the item photo from Gallery or Camera.');
}

function validateMemberListingPayload_(payload) {
  payload = payload || {};
  const settings = settingsMap_();
  if (!bool_(settings.postingEnabled)) throw new Error('Advertisement posting is currently disabled.');
  const category = clean_(payload.category,100);
  if (!rows_('Categories').some(x => x.Status === 'Active' && x.Name === category)) throw new Error('Select a valid active category.');
  const title = clean_(payload.title,120), description = clean_(payload.description,5000);
  const location = clean_(payload.location,120), phone = clean_(payload.phone,40);
  const price = Number(payload.price || 0), currency = clean_(payload.currency || 'MVR',10), condition = clean_(payload.condition || 'Not Applicable',40);
  if (title.length < 4) throw new Error('Enter a clear advertisement title.');
  if (!location) throw new Error('Enter the item location.');
  if (!phone) throw new Error('Enter a contact number.');
  if (description.length < 10) throw new Error('Enter an advertisement description.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid non-negative price.');
  if (!CURRENCIES.includes(currency)) throw new Error('Select a valid currency.');
  if (!ITEM_CONDITIONS.includes(condition)) throw new Error('Select a valid item condition.');
  return { title:title, category:category, location:location, phone:phone, price:price, currency:currency, condition:condition, description:description };
}

function createMemberListingRecord_(memberId, payload, imageFile) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const current = rows_('Members').find(x => Number(x.Id) === Number(memberId));
    if (!current || current.Status !== 'Active') throw new Error('Member account is unavailable.');
    const usage = memberUsage_(current);
    if (!usage.active) throw new Error(usage.reason || 'An approved active package is required before posting.');
    if (usage.remaining <= 0) throw new Error('Your package post limit has been reached. Renew or purchase another package to continue.');
    const id = nextCounter_('AD_ID');
    const reference = 'AD-' + year_() + '-' + pad6_(nextCounter_('AD_REF'));
    const imageFileId = imageFile.getId();
    append_('Advertisements', {
      Id:id, Reference:reference, MemberId:current.Id, MembershipNumber:current.MembershipNumber,
      Title:payload.title, Category:payload.category, Location:payload.location, Price:payload.price,
      Currency:payload.currency, Condition:payload.condition,
      Seller:current.Name, Phone:payload.phone || current.WhatsApp || current.Phone, Description:payload.description,
      Image:advertisementImageUrl_(imageFileId, safeResourceKey_(imageFile)), ImageFileId:imageFileId, ImageResourceKey:safeResourceKey_(imageFile), ImageName:imageFile.getName(),
      ImageMimeType:imageFile.getMimeType(), ImageSize:imageFile.getSize(),
      Status:'Pending Admin Approval', RejectionReason:'', Verified:bool_(current.Verified), Featured:false,
      CreatedAt:nowIso_(), UpdatedAt:nowIso_(), Date:today_()
    });
    notifyAdmins_('New advertisement submitted', current.Name + ' submitted ' + reference + ': ' + payload.title);
    bumpPublicCacheVersion_();
    return { ok:true, reference:reference, remaining:Math.max(0,usage.remaining-1), image:advertisementImageUrl_(imageFileId, safeResourceKey_(imageFile)) };
  } finally { lock.releaseLock(); }
}


function getPaymentSlip(token, paymentId) {
  requirePermission_(token, 'payments.manage');
  const payment = findById_('Payments', paymentId);
  if (!payment || !payment.ProofFileId) throw new Error('Payment slip is unavailable.');
  return paymentSlipData_(payment.ProofFileId);
}

function getMemberPaymentSlip(token, paymentId) {
  const member = requireMember_(token);
  const payment = findById_('Payments', paymentId);
  if (!payment || Number(payment.MemberId) !== Number(member.Id) || !payment.ProofFileId) throw new Error('Payment slip is unavailable.');
  return paymentSlipData_(payment.ProofFileId);
}

function paymentSlipData_(fileId) {
  const file = DriveApp.getFileById(String(fileId));
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (!bytes.length || bytes.length > APP.MAX_SLIP_BYTES) throw new Error('Payment slip file is empty or exceeds the 5 MB limit.');
  const detected = sniffAllowedFileMime_(bytes);
  if (!detected) throw new Error('Payment slip file type is not supported.');
  return { name:file.getName(), mimeType:detected, base64:Utilities.base64Encode(bytes) };
}

// ---------- Admin auth ----------
function adminLogin(email, password) {
  assertInitialized_();
  email = normalizeEmail_(email);
  password = String(password || '');
  if (!validEmail_(email) || !password) throw new Error('Enter the administrator email and password.');
  if (!PropertiesService.getScriptProperties().getProperty(APP.SECRET_PROP)) throw new Error('Administrator credentials require repair. Run restoreAdminLoginFromEditor from the Apps Script editor.');
  const admin = rows_('Admins').find(x => normalizeEmail_(x.Email) === email);
  if (!admin) throw new Error('Invalid administrator email or password.');
  if (admin.Status !== 'Active') throw new Error('This administrator account is inactive.');
  if (!admin.PasswordSalt || !admin.PasswordHash) throw new Error('Administrator credentials require repair. Run restoreAdminLoginFromEditor from the Apps Script editor.');
  const now = Date.now();
  if (admin.LockUntil && new Date(admin.LockUntil).getTime() > now) {
    const unlock = Utilities.formatDate(new Date(admin.LockUntil),'Indian/Maldives','yyyy-MM-dd HH:mm');
    throw new Error('Account temporarily locked until ' + unlock + '.');
  }
  if (admin.LockUntil && new Date(admin.LockUntil).getTime() <= now) updateById_('Admins',admin.Id,{FailedAttempts:0,LockUntil:'',UpdatedAt:nowIso_()});
  if (!verifyPassword_(password, admin.PasswordSalt, admin.PasswordHash)) {
    const failed = Number(admin.FailedAttempts||0)+1;
    const updates = { FailedAttempts:failed, UpdatedAt:nowIso_() };
    if (failed >= APP.MAX_FAILED_LOGINS) updates.LockUntil = new Date(now + APP.LOCK_MINUTES*60000).toISOString();
    updateById_('Admins', admin.Id, updates);
    throw new Error(failed >= APP.MAX_FAILED_LOGINS ? 'Account temporarily locked after repeated failed attempts.' : 'Invalid administrator email or password.');
  }
  const token = createSession_('AdminSessions','AdminId',admin.Id,APP.ADMIN_SESSION_HOURS);
  updateById_('Admins',admin.Id,{FailedAttempts:0,LockUntil:'',LastLogin:nowIso_(),UpdatedAt:nowIso_()});
  return { token:token, mustChangePassword:bool_(admin.MustChangePassword), admin:sanitizeAdmin_(admin), backendVersion:BACKEND_VERSION };
}

function adminLogout(token) { removeSession_('AdminSessions', token); return true; }

function changeAdminPassword(token, currentPassword, newPassword) {
  const admin = requireAdmin_(token);
  if (!verifyPassword_(String(currentPassword||''),admin.PasswordSalt,admin.PasswordHash)) throw new Error('Current password is incorrect.');
  validatePassword_(String(newPassword||''), true);
  const creds = makePassword_(String(newPassword));
  updateById_('Admins',admin.Id,{PasswordSalt:creds.salt,PasswordHash:creds.hash,MustChangePassword:false,UpdatedAt:nowIso_()});
  return {ok:true};
}

function getAdminBootstrap(token) {
  const admin = requireAdmin_(token);
  if (bool_(admin.MustChangePassword)) throw new Error('Change the temporary administrator password before loading dashboard data.');

  // Repair missing/old optional tables before loading. Login only needs Admins and
  // AdminSessions, so older deployments could authenticate but fail here.
  const repairWarnings = ensureAdminDashboardRuntime_();
  return buildAdminBootstrap_(admin, repairWarnings);
}

/** Loads only one administrator advertisement page, keeping the dashboard payload small. */
function getAdminListingsPage(token, request) {
  requirePermission_(token,'listings.view');
  request = request || {};
  const pageSize = Math.max(10,Math.min(100,Number(request.pageSize || APP.ADMIN_LISTING_PAGE_SIZE)));
  const query = clean_(request.query,160).toLowerCase();
  const status = clean_(request.status,60);
  let rows = rows_('Advertisements').filter(function(x) {
    const haystack = (String(x.Reference || '') + ' ' + String(x.Title || '') + ' ' + String(x.Seller || '')).toLowerCase();
    return (!query || haystack.indexOf(query) !== -1) && (!status || String(x.Status || '') === status);
  }).sort((a,b)=>Number(b.Id)-Number(a.Id));
  const total = rows.length;
  const totalPages = Math.max(1,Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1,Number(request.page || 1)),totalPages);
  const start = (page - 1) * pageSize;
  const items = rows.slice(start,start + pageSize);
  return {items:items,total:total,page:page,pageSize:pageSize,totalPages:totalPages,hasMore:start + items.length < total};
}


/**
 * Builds the complete administrator payload with one read per table.
 * The previous version called memberUsage_ for every member, which re-read the
 * Advertisements sheet each time and could time out after a successful login.
 */
function buildAdminBootstrap_(admin, inheritedWarnings) {
  const warnings = (inheritedWarnings || []).slice();
  const permissions = permissionsFor_(admin);
  const allowed = function(permission) { return admin.Role === 'Super Administrator' || permissions.indexOf(permission) !== -1; };
  const listingRead = ['listings.view','listings.edit','listings.approve','listings.delete'].some(function(p){ return allowed(p); });
  const categoryRead = listingRead || allowed('categories.manage');
  const packageRead = allowed('packages.manage') || allowed('members.manage') || allowed('payments.manage');
  const memberRead = allowed('members.manage') || allowed('payments.manage');
  const paymentRead = allowed('payments.manage');
  const settingsRead = allowed('settings.manage');
  const adminsRead = allowed('admins.manage');
  const auditRead = allowed('audit.view');

  // Read every table at most once. All Date values are serialized by rows_().
  const allListings = safeAdminRows_('Advertisements', warnings).sort(function(a,b){ return Number(b.Id)-Number(a.Id); });
  const allMembers = safeAdminRows_('Members', warnings).filter(function(x){ return x.Status !== 'Deleted'; }).sort(function(a,b){ return Number(b.Id)-Number(a.Id); });
  const allPayments = safeAdminRows_('Payments', warnings).sort(function(a,b){ return Number(b.Id)-Number(a.Id); });
  const allPackages = safeAdminRows_('Packages', warnings).sort(orderSort_);
  const rawCategories = safeAdminRows_('Categories', warnings).sort(orderSort_);
  const allAdmins = safeAdminRows_('Admins', warnings);
  const allSettings = safeAdminRows_('Settings', warnings);
  const allAudit = safeAdminRows_('AuditLogs', warnings).sort(function(a,b){ return Number(b.Id)-Number(a.Id); });

  const categoryCounts = {};
  const adsByMember = {};
  allListings.forEach(function(ad) {
    if (String(ad.Status || '') !== 'Deleted') categoryCounts[ad.Category] = (categoryCounts[ad.Category] || 0) + 1;
    const memberId = Number(ad.MemberId || 0);
    if (memberId) {
      if (!adsByMember[memberId]) adsByMember[memberId] = [];
      adsByMember[memberId].push(ad);
    }
  });

  const allCategories = rawCategories.map(function(category) {
    return Object.assign({}, category, { Count:categoryCounts[category.Name] || 0 });
  });
  const members = memberRead ? allMembers.map(function(member) {
    return adminMemberFromListings_(member, adsByMember[Number(member.Id)] || []);
  }) : [];

  // Prevent one very old/large database from exceeding Apps Script response limits.
  // The newest records remain manageable, and the warning is shown in the console.
  const limits = { listings:APP.ADMIN_LISTING_PAGE_SIZE, members:500, payments:500, audit:200 };
  const limitedListings = listingRead ? allListings.slice(0, limits.listings) : [];
  const limitedMembers = memberRead ? limitAdminRows_(members, limits.members, 'members', warnings) : [];
  const limitedPayments = paymentRead ? limitAdminRows_(allPayments, limits.payments, 'payments', warnings) : [];
  const limitedAudit = auditRead ? limitAdminRows_(allAudit, limits.audit, 'audit logs', warnings) : [];
  const paidRevenue = paymentRead ? allPayments.filter(function(x){ return x.Status === 'Paid' && x.Currency === 'MVR'; }).reduce(function(sum,x){ return sum + Number(x.Amount || 0); },0) : 0;

  let logo;
  try { logo = logoPayload_(); }
  catch (error) { logo = {exists:false,dataUrl:'',fileName:'',mimeType:''}; warnings.push('Website logo could not be loaded: ' + errorMessage_(error)); }

  const payload = {
    admin:sanitizeAdmin_(admin), permissions:permissions,
    allPermissions:adminsRead ? ALL_PERMISSIONS.slice() : [],
    roles:adminsRead ? Object.keys(ROLE_PERMISSIONS) : [],
    rolePermissions:adminsRead ? ROLE_PERMISSIONS : {},
    listings:limitedListings,
    pendingListings:listingRead ? allListings.filter(function(x){ return String(x.Status || '').indexOf('Pending') !== -1; }).slice(0,8) : [],
    categories:categoryRead ? allCategories : [],
    packages:packageRead ? allPackages : [],
    members:limitedMembers,
    payments:limitedPayments,
    settings:settingsRead ? allSettings : [],
    logo:logo,
    admins:adminsRead ? allAdmins.map(sanitizeAdmin_) : [],
    audit:limitedAudit,
    categoryOptions:categoryRead ? allCategories.map(function(x){ return x.Name; }) : [],
    packageOptions:packageRead ? allPackages.map(function(x){ return x.Name; }) : [],
    warnings:warnings,
    meta:{
      backendVersion:BACKEND_VERSION,
      generatedAt:nowIso_(),
      totals:{listings:allListings.length,members:allMembers.length,payments:allPayments.length,audit:allAudit.length},
      listingPage:{page:1,pageSize:limits.listings,total:allListings.length,totalPages:Math.max(1,Math.ceil(allListings.length/limits.listings)),hasMore:allListings.length>limits.listings}
    },
    stats:{
      totalListings:listingRead ? allListings.length : 0,
      pendingListings:listingRead ? allListings.filter(function(x){ return String(x.Status).indexOf('Pending') !== -1; }).length : 0,
      publishedListings:listingRead ? allListings.filter(function(x){ return ['published','approved'].indexOf(String(x.Status||'').trim().toLowerCase()) !== -1; }).length : 0,
      rejectedListings:listingRead ? allListings.filter(function(x){ return x.Status === 'Rejected'; }).length : 0,
      totalMembers:memberRead ? allMembers.length : 0,
      paidRevenue:paidRevenue,
      pendingPayments:paymentRead ? allPayments.filter(function(x){ return ['Submitted','Pending','Processing'].indexOf(x.Status) !== -1; }).length : 0,
      activeAdmins:adminsRead ? allAdmins.filter(function(x){ return x.Status === 'Active'; }).length : 0
    }
  };

  // Force serialization here so errors are reported before google.script.run tries
  // to transfer the object to the browser.
  try {
    const json = JSON.stringify(payload);
    payload.meta.payloadBytes = json.length;
    if (json.length > 2500000) warnings.push('Administrator dashboard payload is large (' + json.length + ' bytes). Archive old records or use filters.');
  } catch (error) {
    throw new Error('Administrator dashboard data could not be serialized: ' + errorMessage_(error));
  }
  return payload;
}

function ensureAdminDashboardRuntime_() {
  const warnings = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty(APP.SECRET_PROP)) {
      props.setProperty(APP.SECRET_PROP, randomToken_(48));
      warnings.push('Missing security secret was recreated. Existing sessions were invalidated.');
      try { sheet_('AdminSessions').clearContents(); ensureSheet_(getDb_(false),'AdminSessions',SHEMAS.AdminSessions); } catch (ignored) {}
      try { sheet_('MemberSessions').clearContents(); ensureSheet_(getDb_(false),'MemberSessions',SHEMAS.MemberSessions); } catch (ignored) {}
    }
    const ss = getDb_(false);
    Object.keys(SHEMAS).forEach(function(name) { ensureSheet_(ss, name, SHEMAS[name]); });
    seedSettings_();
    seedCounters_();
    repairCounters_();
    ensureFolders_();
    purgeExpiredSessions_();
  } catch (error) {
    throw new Error('Administrator dashboard database repair failed: ' + errorMessage_(error));
  } finally {
    lock.releaseLock();
  }
  return warnings;
}

function safeAdminRows_(name, warnings) {
  try { return rows_(name); }
  catch (error) {
    warnings.push(name + ' table could not be loaded: ' + errorMessage_(error));
    return [];
  }
}

function limitAdminRows_(rows, limit, label, warnings) {
  if (rows.length <= limit) return rows;
  warnings.push('Only the newest ' + limit + ' ' + label + ' are shown. Total: ' + rows.length + '.');
  return rows.slice(0, limit);
}

function adminMemberFromListings_(member, memberListings) {
  const usage = memberUsageFromListings_(member, memberListings || []);
  return {
    Id:Number(member.Id), MembershipNumber:member.MembershipNumber, Name:member.Name, Email:member.Email,
    Phone:member.Phone, WhatsApp:member.WhatsApp, AccountType:member.AccountType, Status:member.Status,
    Verified:bool_(member.Verified), PackageId:Number(member.PackageId||0), Package:member.Package||'',
    PackageStart:member.PackageStart||'', PackageExpiry:member.PackageExpiry||'', PostLimit:Number(member.PostLimit||0),
    CreatedAt:member.CreatedAt||'', UpdatedAt:member.UpdatedAt||'', LastLogin:member.LastLogin||'',
    UsedPosts:usage.used, RemainingPosts:usage.remaining, PackageActive:usage.active, PackageReason:usage.reason
  };
}

function memberUsageFromListings_(member, listings) {
  const limit = Number(member.PostLimit || 0);
  const start = member.PackageStart ? new Date(member.PackageStart).getTime() : 0;
  const expiry = member.PackageExpiry ? new Date(member.PackageExpiry).getTime() : 0;
  const now = Date.now();
  if (!member.PackageId || !member.Package) return {active:false,used:0,limit:0,remaining:0,reason:'Your payment must be approved and a package assigned before posting.'};
  if (!start || !expiry || !Number.isFinite(start) || !Number.isFinite(expiry) || expiry < now) return {active:false,used:0,limit:limit,remaining:0,reason:'Your package has expired. Submit a renewal payment to continue.'};
  const used = (listings || []).filter(function(ad) {
    if (['Deleted','Rejected'].indexOf(String(ad.Status || '')) !== -1) return false;
    const created = new Date(ad.CreatedAt).getTime();
    return Number.isFinite(created) && created >= start && created <= expiry;
  }).length;
  return {active:true,used:used,limit:limit,remaining:Math.max(0,limit-used),reason:''};
}

/** Authenticated self-repair used by the Admin page before one automatic retry. */
function repairAdminDashboardSession(token) {
  const admin = requireAdmin_(token);
  if (bool_(admin.MustChangePassword)) throw new Error('Change the temporary administrator password before repairing the dashboard.');
  const warnings = ensureAdminDashboardRuntime_();
  return {ok:true,backendVersion:BACKEND_VERSION,warnings:warnings};
}

/** Run from the Apps Script editor without changing the current Admin password. */
function repairAdminDashboardFromEditor() {
  if (!isInitialized_()) setupSystem();
  const warnings = ensureAdminDashboardRuntime_();
  migrateApprovedListingsToPublished_();
  repairAdvertisementImages_();
  scrubAuditLogs_();
  const report = diagnoseAdminDashboardFromEditor();
  report.repairWarnings = warnings;
  Logger.log(JSON.stringify(report,null,2));
  return report;
}

function diagnoseAdminDashboardFromEditor() {
  const login = diagnoseAdminLoginFromEditor();
  const result = {
    ok:false,
    backendVersion:BACKEND_VERSION,
    login:login,
    bootstrapSerializable:false,
    payloadBytes:0,
    warnings:[],
    error:''
  };
  if (!login.ok) {
    result.error = 'Administrator login is not ready. Run restoreAdminLoginFromEditor first.';
    Logger.log(JSON.stringify(result,null,2));
    return result;
  }
  try {
    ensureAdminDashboardRuntime_();
    const admin = rows_('Admins').find(function(x){ return normalizeEmail_(x.Email) === normalizeEmail_(APP.SUPER_ADMIN_EMAIL); });
    const copy = Object.assign({}, admin, {MustChangePassword:false});
    const payload = buildAdminBootstrap_(copy, []);
    const json = JSON.stringify(payload);
    result.bootstrapSerializable = true;
    result.payloadBytes = json.length;
    result.warnings = payload.warnings || [];
    result.ok = true;
  } catch (error) {
    result.error = errorMessage_(error);
  }
  Logger.log(JSON.stringify(result,null,2));
  return result;
}

// ---------- Admin CRUD ----------
function saveListing(token, data) {
  const admin = requirePermission_(token,'listings.edit'); data=data||{};
  const id=Number(data.Id||0), now=nowIso_();
  const previous = id ? findById_('Advertisements',id) : null;
  if (id && !previous) throw new Error('Advertisement not found.');
  const clean = {
    Title:clean_(data.Title,120),Category:clean_(data.Category,100),Location:clean_(data.Location,120),Price:Number(data.Price||0),
    Currency:clean_(data.Currency||'MVR',10),Condition:clean_(data.Condition||'Not Applicable',40),Seller:clean_(data.Seller,120),
    Phone:clean_(data.Phone,40),Date:clean_(data.Date||today_(),20),Status:clean_(data.Status||'Draft',50),
    Description:clean_(data.Description,5000),Verified:bool_(data.Verified),Featured:bool_(data.Featured),UpdatedAt:now
  };
  if (!clean.Title) throw new Error('Advertisement title is required.');
  if (!LISTING_STATUSES.includes(clean.Status) && clean.Status !== 'Approved') throw new Error('Invalid advertisement status.');
  if (clean.Category && !rows_('Categories').some(x => x.Name === clean.Category)) throw new Error('Select a valid category.');
  if (!Number.isFinite(clean.Price) || clean.Price < 0) throw new Error('Enter a valid non-negative price.');
  if (!CURRENCIES.includes(clean.Currency)) throw new Error('Select a valid currency.');
  if (!ITEM_CONDITIONS.includes(clean.Condition)) throw new Error('Select a valid item condition.');
  if (clean.Status === 'Approved') clean.Status = 'Published';

  if (id) {
    if (bool_(data.RemoveImage)) {
      trashAdvertisementImage_(previous);
      Object.assign(clean,{Image:'',ImageFileId:'',ImageResourceKey:'',ImageName:'',ImageMimeType:'',ImageSize:'',Status:'Unpublished'});
    }
    const effectiveImage = bool_(data.RemoveImage) ? '' : (previous.ImageFileId || previous.Image || '');
    if (clean.Status === 'Published' && !effectiveImage) throw new Error('A published advertisement must have an item photo. Upload a photo from the member account before publishing.');
    updateById_('Advertisements',id,clean);
    audit_(admin,'UPDATE','Advertisement',id,previous,clean);
  } else {
    const newId=nextCounter_('AD_ID'), ref='AD-'+year_()+'-'+pad6_(nextCounter_('AD_REF'));
    append_('Advertisements',Object.assign({Id:newId,Reference:ref,MemberId:'',MembershipNumber:'',Image:'',ImageFileId:'',ImageResourceKey:'',ImageName:'',ImageMimeType:'',ImageSize:'',RejectionReason:'',CreatedAt:now},clean));
    audit_(admin,'CREATE','Advertisement',newId,'',clean);
  }
  bumpPublicCacheVersion_();
  return {ok:true};
}

function updateListingStatus(token,id,status,reason) {
  const admin=requirePermission_(token,'listings.approve');
  const prev=findById_('Advertisements',id); if(!prev) throw new Error('Advertisement not found.');
  const requested = clean_(status,50);
  const allowed = LISTING_STATUSES.concat(['Approved']);
  if (!allowed.includes(requested)) throw new Error('Invalid advertisement status.');
  // One-click approval also publishes. This removes the old Approved-but-not-visible state.
  const finalStatus = requested === 'Approved' ? 'Published' : requested;
  if (finalStatus === 'Published' && !prev.ImageFileId && !prev.Image) throw new Error('This advertisement has no item photo and cannot be published.');
  const updates={
    Status:finalStatus,
    RejectionReason:finalStatus === 'Rejected' ? clean_(reason,500) : '',
    UpdatedAt:nowIso_()
  };
  updateById_('Advertisements',id,updates);
  audit_(admin,'STATUS','Advertisement',id,prev.Status,finalStatus);
  bumpPublicCacheVersion_();
  return {ok:true,status:finalStatus,public:finalStatus==='Published'};
}

/** Converts records approved by older versions into the canonical Published state. */
function migrateApprovedListingsToPublished_() {
  if (!isInitialized_()) return 0;
  let changed = 0;
  rows_('Advertisements').forEach(function(ad) {
    if (String(ad.Status || '').trim().toLowerCase() === 'approved') {
      updateById_('Advertisements', ad.Id, { Status:'Published', RejectionReason:'', UpdatedAt:nowIso_() });
      changed++;
    }
  });
  if (changed) bumpPublicCacheVersion_();
  return changed;
}

/** Run manually once from the Apps Script editor when upgrading an existing deployment. */
function publishPreviouslyApprovedListingsFromEditor() {
  assertInitialized_();
  const changed = migrateApprovedListingsToPublished_();
  Logger.log('Approved advertisements converted to Published: ' + changed);
  return { ok:true, converted:changed };
}

function deleteListing(token,id) { const admin=requirePermission_(token,'listings.delete'); const prev=findById_('Advertisements',id); if(!prev)throw new Error('Advertisement not found.'); trashAdvertisementImage_(prev); deleteById_('Advertisements',id); audit_(admin,'DELETE','Advertisement',id,prev,''); bumpPublicCacheVersion_(); return {ok:true}; }

function saveCategory(token,data) {
  const admin = requirePermission_(token,'categories.manage');
  data = data || {};
  const id = Number(data.Id || 0);
  const obj = { Name:clean_(data.Name,100), Icon:clean_(data.Icon || '◉',20), DisplayOrder:Math.max(0,Number(data.DisplayOrder || 0)), Status:clean_(data.Status || 'Active',20), UpdatedAt:nowIso_() };
  if (!obj.Name) throw new Error('Category name is required.');
  if (!['Active','Inactive'].includes(obj.Status)) throw new Error('Invalid category status.');
  const duplicate = rows_('Categories').find(x => normalizeName_(x.Name) === normalizeName_(obj.Name) && Number(x.Id) !== id);
  if (duplicate) throw new Error('A category with this name already exists.');
  if (id) {
    const prev = findById_('Categories',id); if (!prev) throw new Error('Category not found.');
    updateById_('Categories',id,obj); audit_(admin,'UPDATE','Category',id,prev,obj);
  } else {
    const newId = nextCounter_('CATEGORY_ID');
    append_('Categories',Object.assign({Id:newId,CreatedAt:nowIso_()},obj));
    audit_(admin,'CREATE','Category',newId,'',obj);
  }
  bumpPublicCacheVersion_();
  return {ok:true};
}
function deleteCategory(token,id) {
  const admin = requirePermission_(token,'categories.manage');
  const prev = findById_('Categories',id); if (!prev) throw new Error('Category not found.');
  if (rows_('Advertisements').some(x => x.Category === prev.Name)) throw new Error('This category is used by advertisements. Set it inactive instead of deleting it.');
  deleteById_('Categories',id); audit_(admin,'DELETE','Category',id,prev,''); bumpPublicCacheVersion_();
  return {ok:true};
}

function savePackage(token,data) {
  const admin = requirePermission_(token,'packages.manage');
  data = data || {};
  const id = Number(data.Id || 0);
  const price = Number(data.Price || 0), posts = Number(data.Posts || 0), validity = Number(data.ValidityDays || 30);
  if (!Number.isFinite(price) || price < 0) throw new Error('Package price must be a non-negative number.');
  if (!Number.isInteger(posts) || posts < 0) throw new Error('Post limit must be a non-negative whole number.');
  if (!Number.isInteger(validity) || validity < 1) throw new Error('Validity days must be at least 1.');
  const obj = { Name:clean_(data.Name,100), Price:price, Posts:posts, ValidityDays:validity, Description:clean_(data.Description,1000), Recommended:bool_(data.Recommended), DisplayOrder:Math.max(0,Number(data.DisplayOrder || 0)), Status:clean_(data.Status || 'Active',20), UpdatedAt:nowIso_() };
  if (!obj.Name) throw new Error('Package name is required.');
  if (!['Active','Inactive'].includes(obj.Status)) throw new Error('Invalid package status.');
  const duplicate = rows_('Packages').find(x => normalizeName_(x.Name) === normalizeName_(obj.Name) && Number(x.Id) !== id);
  if (duplicate) throw new Error('A package with this name already exists.');
  if (id) {
    const prev = findById_('Packages',id); if (!prev) throw new Error('Package not found.');
    updateById_('Packages',id,obj); audit_(admin,'UPDATE','Package',id,prev,obj);
  } else {
    const newId = nextCounter_('PACKAGE_ID'); append_('Packages',Object.assign({Id:newId,CreatedAt:nowIso_()},obj)); audit_(admin,'CREATE','Package',newId,'',obj);
  }
  bumpPublicCacheVersion_();
  return {ok:true};
}
function deletePackage(token,id) {
  const admin = requirePermission_(token,'packages.manage');
  const prev = findById_('Packages',id); if (!prev) throw new Error('Package not found.');
  if (rows_('Members').some(x => Number(x.PackageId) === Number(id) && x.Status === 'Active')) throw new Error('This package is assigned to active members. Set it inactive instead.');
  if (rows_('Payments').some(x => Number(x.PackageId) === Number(id))) throw new Error('This package is referenced by payment history. Set it inactive instead.');
  deleteById_('Packages',id); audit_(admin,'DELETE','Package',id,prev,''); bumpPublicCacheVersion_();
  return {ok:true};
}

function saveMember(token,data) {
  const admin = requirePermission_(token,'members.manage');
  data = data || {};
  const id = Number(data.Id || 0), now = nowIso_();
  const member = id ? findById_('Members',id) : null;
  if (id && !member) throw new Error('Member not found.');
  const obj = { Name:clean_(data.Name,120), Email:normalizeEmail_(data.Email), Phone:clean_(data.Phone,40), WhatsApp:clean_(data.WhatsApp || data.Phone,40), AccountType:clean_(data.AccountType || 'Individual',60), Status:clean_(data.Status || 'Active',20), Verified:bool_(data.Verified), UpdatedAt:now };
  if (!obj.Name || !validEmail_(obj.Email)) throw new Error('Valid name and email are required.');
  if (!MEMBER_STATUSES.includes(obj.Status)) throw new Error('Invalid member status.');
  if (!ACCOUNT_TYPES.includes(obj.AccountType)) throw new Error('Invalid account type.');
  const emailDuplicate = rows_('Members').find(x => normalizeEmail_(x.Email) === obj.Email && Number(x.Id) !== id && x.Status !== 'Deleted');
  if (emailDuplicate) throw new Error('Another member already uses this email address.');
  const desired = clean_(data.Package,100);
  if (desired && (!member || desired !== member.Package)) Object.assign(obj, packageAssignmentByName_(desired));
  if (!desired && member && member.Package) Object.assign(obj,{PackageId:'',Package:'',PackageStart:'',PackageExpiry:'',PostLimit:0});
  if (id) {
    const prev = member; updateById_('Members',id,obj);
    if (obj.Status !== 'Active') deleteSessionsFor_('MemberSessions','MemberId',id);
    audit_(admin,'UPDATE','Member',id,prev,obj); return {ok:true};
  }
  const password = generatePassword_(), creds = makePassword_(password), newId = nextCounter_('MEMBER_ID'), membership = 'MVM-' + year_() + '-' + pad6_(nextCounter_('MEMBERSHIP'));
  append_('Members',Object.assign({Id:newId,MembershipNumber:membership,PasswordSalt:creds.salt,PasswordHash:creds.hash,PackageId:'',Package:'',PackageStart:'',PackageExpiry:'',PostLimit:0,CreatedAt:now,LastLogin:'',FailedAttempts:0,LockUntil:''},obj));
  trySend_(obj.Email,'MV Market member account','Membership Number: ' + membership + '\nTemporary password: ' + password + '\nPlease change it after login.');
  audit_(admin,'CREATE','Member',newId,'',obj); return {ok:true,temporaryPassword:password,membershipNumber:membership};
}

function savePayment(token,data) {
  const admin = requirePermission_(token,'payments.manage');
  data = data || {};
  const id = Number(data.Id || 0), now = nowIso_();
  const existing = id ? findById_('Payments',id) : null;
  if (id && !existing) throw new Error('Payment not found.');

  let packageId = Number(data.PackageId || (existing && existing.PackageId) || 0);
  let packageName = clean_(data.PackageName || (existing && existing.PackageName),100);
  let pack = packageId ? findById_('Packages',packageId) : null;
  if (!pack && packageName) pack = rows_('Packages').find(x => normalizeName_(x.Name) === normalizeName_(packageName));
  if (pack) { packageId = Number(pack.Id); packageName = pack.Name; }

  const membershipNumber = clean_(data.MembershipNumber || (existing && existing.MembershipNumber),40);
  const member = rows_('Members').find(x => x.MembershipNumber === membershipNumber) || ((existing && existing.MemberId) ? findById_('Members',existing.MemberId) : null);
  const amountRaw = data.Amount === '' || data.Amount === undefined ? (existing ? existing.Amount : (pack ? pack.Price : 0)) : data.Amount;
  const amount = Number(amountRaw || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid non-negative payment amount.');

  const status = clean_(data.Status || (existing && existing.Status) || 'Pending',30);
  if (!PAYMENT_STATUSES.includes(status)) throw new Error('Invalid payment status.');
  if (status === 'Paid' && !member) throw new Error('Select a valid membership number before approving payment.');
  if (status === 'Paid' && !pack) throw new Error('Select a valid package before approving payment.');

  const transactionReference = clean_(data.TransactionReference || (existing && existing.TransactionReference),120);
  if (transactionReference) {
    const duplicate = rows_('Payments').find(x => Number(x.Id) !== id && String(x.TransactionReference || '').trim().toLowerCase() === transactionReference.toLowerCase() && !['Rejected','Failed','Cancelled'].includes(String(x.Status || '')));
    if (duplicate) throw new Error('This transaction/reference number already exists as ' + duplicate.Reference + '.');
  }

  const reference = clean_(data.Reference || (existing && existing.Reference),60) || ('PAY-' + year_() + '-' + pad6_(nextCounter_('PAYMENT_REF')));
  const currency = clean_(data.Currency || (existing && existing.Currency) || 'MVR',10);
  if (!CURRENCIES.includes(currency)) throw new Error('Select a valid payment currency.');
  const obj = {
    Reference:reference,
    MemberId:member ? member.Id : (existing ? existing.MemberId : ''),
    MembershipNumber:member ? member.MembershipNumber : membershipNumber,
    MemberName:member ? member.Name : clean_(data.MemberName || (existing && existing.MemberName),120),
    PackageId:pack ? pack.Id : (packageId || ''),
    PackageName:pack ? pack.Name : packageName,
    Amount:amount,
    Currency:currency,
    Method:clean_(data.Method || (existing && existing.Method) || 'Bank Transfer',60),
    TransactionReference:transactionReference,
    ProofUrl:clean_(data.ProofUrl || (existing && existing.ProofUrl),1000),
    Status:status,
    AdminNote:clean_(data.AdminNote,1000),
    UpdatedAt:now
  };

  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (id) {
      const prev = existing;
      let assignment = null;
      if (status === 'Paid' && prev.Status !== 'Paid') {
        assignment = packageAssignment_(pack);
        updateById_('Members',member.Id,assignment);
        obj.ApprovedAt = now;
      }
      updateById_('Payments',id,obj);
      if (assignment) {
        trySend_(member.Email,'Payment approved - ' + pack.Name,'Your payment ' + reference + ' has been approved.\nPackage: ' + pack.Name + '\nPost limit: ' + pack.Posts + '\nExpiry: ' + assignment.PackageExpiry);
        audit_(admin,'APPROVE_PACKAGE','Member',member.Id,member.Package,pack.Name);
      }
      audit_(admin,'UPDATE','Payment',id,prev,obj);
      return {ok:true};
    }
    const newId = nextCounter_('PAYMENT_ID');
    const row = Object.assign({Id:newId,ProofFileId:'',CreatedAt:now,ApprovedAt:''},obj);
    if (status === 'Paid') {
      const assignment = packageAssignment_(pack);
      updateById_('Members',member.Id,assignment);
      row.ApprovedAt = now;
      trySend_(member.Email,'Payment approved - ' + pack.Name,'Your payment ' + reference + ' has been approved.\nPackage: ' + pack.Name + '\nPost limit: ' + pack.Posts + '\nExpiry: ' + assignment.PackageExpiry);
      audit_(admin,'APPROVE_PACKAGE','Member',member.Id,member.Package,pack.Name);
    }
    append_('Payments',row);
    audit_(admin,'CREATE','Payment',newId,'',obj);
    return {ok:true};
  } finally { lock.releaseLock(); }
}

function saveSettings(token,items) {
  const admin = requirePermission_(token,'settings.manage');
  const existingKeys = new Set(rows_('Settings').map(x=>x.Key));
  const cleaned = (items || []).map(item => {
    const key = clean_(item.Key,80);
    if (!existingKeys.has(key)) throw new Error('Unknown website setting: ' + key);
    const type = clean_(item.Type || 'text',20);
    let value = item.Value;
    if (type === 'boolean') value = bool_(value) ? 'true' : 'false';
    else if (type === 'number') {
      const n = Number(value); if (!Number.isFinite(n)) throw new Error('Invalid number for setting ' + key + '.');
      value = String(key === 'autoRefreshSeconds' ? Math.max(10,Math.min(3600,n)) : n);
    } else if (type === 'color') {
      value = String(value || '').trim(); if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Invalid colour for setting ' + key + '.');
    } else if (type === 'email') {
      value = normalizeEmail_(value); if (value && !validEmail_(value)) throw new Error('Invalid email address for setting ' + key + '.');
    } else value = clean_(value,type === 'textarea' ? 5000 : 500);
    return {Key:key,Value:value,Type:type};
  });
  cleaned.forEach(x=>upsertSetting_(x.Key,x.Value,x.Type));
  audit_(admin,'UPDATE','Settings','ALL','',cleaned);
  bumpPublicCacheVersion_();
  return {ok:true};
}


/** Upload or replace the website logo. PNG, JPG/JPEG and WebP are supported. */
function uploadWebsiteLogo(token, payload) {
  const admin = requirePermission_(token, 'settings.manage');
  payload = payload || {};
  const fileName = clean_(payload.fileName, 180);
  const declaredMime = String(payload.mimeType || '').toLowerCase();
  const source = String(payload.fileData || '');
  const match = source.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!fileName || !match) throw new Error('Choose a valid PNG, JPG, JPEG or WebP logo file.');
  let mimeType = String(match[1] || declaredMime).toLowerCase();
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (!['image/png','image/jpeg','image/webp'].includes(mimeType)) throw new Error('Only PNG, JPG, JPEG and WebP logo files are supported.');
  let bytes;
  try { bytes = Utilities.base64Decode(match[2].replace(/\s/g, '')); }
  catch (e) { throw new Error('The selected logo file could not be read.'); }
  if (!bytes.length) throw new Error('The selected logo file is empty.');
  if (bytes.length > APP.MAX_LOGO_BYTES) throw new Error('Logo file must be 2 MB or smaller.');
  const detectedMime = sniffAllowedFileMime_(bytes);
  if (!['image/png','image/jpeg','image/webp'].includes(detectedMime)) throw new Error('Logo content is not a valid PNG, JPG or WebP image.');
  if (mimeType !== detectedMime) throw new Error('Logo file extension/type does not match its content.');
  mimeType = detectedMime;

  const safeName = 'website_logo_' + Date.now() + '_' + fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const blob = Utilities.newBlob(bytes, mimeType, safeName);
  const folder = getFolder_('Website Logo');
  const file = folder.createFile(blob);
  const props = PropertiesService.getScriptProperties();
  const oldFileId = props.getProperty(APP.LOGO_FILE_PROP) || '';
  props.setProperties({
    [APP.LOGO_FILE_PROP]: file.getId(),
    [APP.LOGO_NAME_PROP]: fileName,
    [APP.LOGO_MIME_PROP]: mimeType
  }, false);
  if (oldFileId && oldFileId !== file.getId()) {
    try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
  }
  audit_(admin, 'UPLOAD', 'Website Logo', file.getId(), oldFileId, { fileName:fileName, mimeType:mimeType, bytes:bytes.length });
  return logoPayload_();
}

/** Remove the current website logo and return to the automatic MV fallback mark. */
function removeWebsiteLogo(token) {
  const admin = requirePermission_(token, 'settings.manage');
  const props = PropertiesService.getScriptProperties();
  const oldFileId = props.getProperty(APP.LOGO_FILE_PROP) || '';
  if (oldFileId) {
    try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
  }
  props.deleteProperty(APP.LOGO_FILE_PROP);
  props.deleteProperty(APP.LOGO_NAME_PROP);
  props.deleteProperty(APP.LOGO_MIME_PROP);
  audit_(admin, 'REMOVE', 'Website Logo', oldFileId || 'NONE', oldFileId, '');
  return logoPayload_();
}

function saveAdmin(token,data) {
  const actor = requirePermission_(token,'admins.manage');
  data = data || {};
  const id = Number(data.Id || 0), now = nowIso_();
  const previous = id ? findById_('Admins',id) : null;
  if (id && !previous) throw new Error('Administrator not found.');
  const role = clean_(data.Role || 'Content Moderator',80);
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS,role)) throw new Error('Invalid administrator role.');
  const requestedPermissions = Array.isArray(data.Permissions) ? data.Permissions.filter(x => ALL_PERMISSIONS.includes(x)) : [];
  const obj = { Name:clean_(data.Name,120), Email:normalizeEmail_(data.Email), Role:role, Permissions:JSON.stringify(role === 'Super Administrator' ? ALL_PERMISSIONS : requestedPermissions), Status:clean_(data.Status || 'Active',20), UpdatedAt:now };
  if (!obj.Name || !validEmail_(obj.Email)) throw new Error('Valid administrator name and email are required.');
  if (!ADMIN_STATUSES.includes(obj.Status)) throw new Error('Invalid administrator status.');
  const duplicate = rows_('Admins').find(x => normalizeEmail_(x.Email) === obj.Email && Number(x.Id) !== id);
  if (duplicate) throw new Error('An administrator already exists with this email.');
  if (previous && normalizeEmail_(previous.Email) === normalizeEmail_(APP.SUPER_ADMIN_EMAIL)) {
    if (obj.Email !== normalizeEmail_(APP.SUPER_ADMIN_EMAIL)) throw new Error('The primary Super Administrator email cannot be changed.');
    if (obj.Role !== 'Super Administrator' || obj.Status !== 'Active') throw new Error('The primary Super Administrator cannot be demoted or deactivated.');
  }
  if (id) {
    updateById_('Admins',id,obj);
    if (obj.Status !== 'Active') deleteSessionsFor_('AdminSessions','AdminId',id);
    audit_(actor,'UPDATE','Administrator',id,previous,obj);
    return {ok:true};
  }
  const password = generatePassword_(), creds = makePassword_(password), newId = nextCounter_('ADMIN_ID');
  append_('Admins',Object.assign({Id:newId,PasswordSalt:creds.salt,PasswordHash:creds.hash,MustChangePassword:true,FailedAttempts:0,LockUntil:'',LastLogin:'',CreatedAt:now},obj));
  const emailSent = trySend_(obj.Email,'MV Market administrator account','Temporary password: ' + password + '\nChange it at first login.');
  audit_(actor,'CREATE','Administrator',newId,'',obj);
  return {ok:true,temporaryPassword:password,emailSent:emailSent};
}

function resetAdminPassword(token,id){const actor=requirePermission_(token,'admins.manage'),admin=findById_('Admins',id);if(!admin)throw new Error('Administrator not found.');const password=generatePassword_(),creds=makePassword_(password);updateById_('Admins',id,{PasswordSalt:creds.salt,PasswordHash:creds.hash,MustChangePassword:true,FailedAttempts:0,LockUntil:'',UpdatedAt:nowIso_()});deleteSessionsFor_('AdminSessions','AdminId',id);const emailSent=trySend_(admin.Email,'MV Market administrator password reset','Temporary password: '+password);audit_(actor,'PASSWORD_RESET','Administrator',id,'','Reset');return{temporaryPassword:password,emailSent:emailSent};}

// ---------- Business logic helpers ----------
function approvePaymentPackage_(payment,admin){
  let member=payment.MemberId?findById_('Members',payment.MemberId):rows_('Members').find(x=>x.MembershipNumber===payment.MembershipNumber);
  if(!member)throw new Error('Cannot approve payment: member not found.');
  let pack=payment.PackageId?findById_('Packages',payment.PackageId):rows_('Packages').find(x=>x.Name===payment.PackageName);
  if(!pack)throw new Error('Select a valid package before approving this payment.');
  const assignment=packageAssignment_(pack);
  updateById_('Members',member.Id,assignment);
  updateById_('Payments',payment.Id,{MemberId:member.Id,PackageId:pack.Id,PackageName:pack.Name,ApprovedAt:nowIso_(),UpdatedAt:nowIso_()});
  trySend_(member.Email,'Payment approved - '+pack.Name,'Your payment '+payment.Reference+' has been approved.\nPackage: '+pack.Name+'\nPost limit: '+pack.Posts+'\nExpiry: '+assignment.PackageExpiry);
  audit_(admin,'APPROVE_PACKAGE','Member',member.Id,member.Package,pack.Name);
}
function packageAssignmentByName_(name){const pack=rows_('Packages').find(x=>x.Name===name&&x.Status==='Active');if(!pack)throw new Error('Selected package is not active.');return packageAssignment_(pack);}
function packageAssignment_(pack){const start=new Date(),expiry=new Date(start.getTime()+Math.max(1,Number(pack.ValidityDays||30))*86400000);return{PackageId:pack.Id,Package:pack.Name,PackageStart:start.toISOString(),PackageExpiry:expiry.toISOString(),PostLimit:Number(pack.Posts||0),UpdatedAt:nowIso_()};}
function memberUsage_(member){
  const limit=Number(member.PostLimit||0),start=member.PackageStart?new Date(member.PackageStart).getTime():0,expiry=member.PackageExpiry?new Date(member.PackageExpiry).getTime():0,now=Date.now();
  if(!member.PackageId||!member.Package)return{active:false,used:0,limit:0,remaining:0,reason:'Your payment must be approved and a package assigned before posting.'};
  if(!start||!expiry||expiry<now)return{active:false,used:0,limit:limit,remaining:0,reason:'Your package has expired. Submit a renewal payment to continue.'};
  const used=rows_('Advertisements').filter(x=>Number(x.MemberId)===Number(member.Id)&&!['Deleted','Rejected'].includes(x.Status)&&new Date(x.CreatedAt).getTime()>=start&&new Date(x.CreatedAt).getTime()<=expiry).length;
  return{active:true,used:used,limit:limit,remaining:Math.max(0,limit-used),reason:''};
}
function firstNonEmptyBlob_(candidates) {
  for (let i = 0; i < (candidates || []).length; i++) {
    const blob = candidates[i];
    if (!blob || typeof blob.getBytes !== 'function') continue;
    try { if (blob.getBytes().length) return blob; } catch (ignored) {}
  }
  return null;
}

function clientCompressedImageBlob_(dataUrl, fileName, declaredMime) {
  const source = String(dataUrl || '');
  if (!source) return null;
  if (source.length > 5 * 1024 * 1024) throw new Error('The optimized photo payload is too large.');
  const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('The optimized photo data is invalid.');
  let mime = String(match[1] || declaredMime || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  let bytes;
  try { bytes = Utilities.base64Decode(match[2].replace(/\s/g,'')); }
  catch (error) { throw new Error('The optimized photo could not be decoded.'); }
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error('The optimized photo must be 3 MB or smaller.');
  const detected = sniffAllowedFileMime_(bytes);
  if (!['image/jpeg','image/png','image/webp'].includes(detected) || detected !== mime) throw new Error('The optimized photo format is invalid.');
  const safeName = clean_(fileName || 'item-photo-optimized.jpg',140) || 'item-photo-optimized.jpg';
  return Utilities.newBlob(bytes,detected,safeName);
}

function saveAdvertisementImageBlob_(member, uploadBlob) {
  let fileName = String(uploadBlob.getName ? uploadBlob.getName() : 'item-photo').trim() || 'item-photo';
  const bytes = uploadBlob.getBytes();
  if (!bytes || !bytes.length) throw new Error('The selected item photo is empty.');
  if (bytes.length > APP.MAX_AD_IMAGE_BYTES) throw new Error('Item photo must be 10 MB or smaller.');

  let declaredMime = String(uploadBlob.getContentType ? uploadBlob.getContentType() : '').toLowerCase().split(';')[0].trim();
  if (declaredMime === 'image/jpg') declaredMime = 'image/jpeg';
  const detectedMime = sniffAllowedFileMime_(bytes);
  if (!['image/jpeg','image/png','image/webp'].includes(detectedMime)) throw new Error('Item photo must be a valid JPG, JPEG, PNG or WebP image.');
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== detectedMime) throw new Error('The item photo type does not match its actual image content.');

  const safeName = advertisementImageFileName_(member, fileName, detectedMime);
  const file = getFolder_('Advertisement Images').createFile(Utilities.newBlob(bytes, detectedMime, safeName));
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    try { if (file.getSecurityUpdateEligible && file.getSecurityUpdateEligible()) file.setSecurityUpdateEnabled(false); } catch (ignored) {}
  } catch (error) {
    try { file.setTrashed(true); } catch (ignored) {}
    throw new Error('The item photo could not be made visible on the public website. Check Google Drive sharing policy and try again.');
  }
  return file;
}

function advertisementImageFileName_(member, fileName, mimeType) {
  const extByMime = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp' };
  let cleanName = String(fileName || 'item-photo').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').slice(-120);
  if (!/\.(jpe?g|png|webp)$/i.test(cleanName)) cleanName += extByMime[mimeType] || '';
  return String(member.MembershipNumber || 'MEMBER') + '_' + Date.now() + '_' + cleanName;
}

function safeResourceKey_(file) { try { return String(file.getResourceKey ? (file.getResourceKey() || '') : ''); } catch (ignored) { return ''; } }

function advertisementImageUrl_(fileId, resourceKey) {
  if (!fileId) return '';
  let url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(String(fileId)) + '&sz=w1600';
  if (resourceKey) url += '&resourcekey=' + encodeURIComponent(String(resourceKey));
  return url;
}

function trashAdvertisementImage_(listing) {
  if (!listing || !listing.ImageFileId) return false;
  try { DriveApp.getFileById(String(listing.ImageFileId)).setTrashed(true); return true; }
  catch (ignored) { return false; }
}

function repairAdvertisementImages_() {
  if (!isInitialized_()) return { checked:0, repaired:0, missing:[] };
  let repaired = 0;
  const missing = [];
  rows_('Advertisements').forEach(function(ad) {
    if (!ad.ImageFileId) return;
    try {
      const file = DriveApp.getFileById(String(ad.ImageFileId));
      const mime = String(file.getMimeType() || '').toLowerCase();
      if (!['image/jpeg','image/png','image/webp'].includes(mime)) {
        missing.push(ad.Reference + ': unsupported image MIME ' + mime); return;
      }
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); if (file.getSecurityUpdateEligible && file.getSecurityUpdateEligible()) file.setSecurityUpdateEnabled(false); } catch (ignored) {}
      const resourceKey = safeResourceKey_(file);
      const expected = advertisementImageUrl_(ad.ImageFileId, resourceKey);
      const updates = {};
      if (String(ad.Image || '') !== expected) updates.Image = expected;
      if (String(ad.ImageResourceKey||'') !== resourceKey) updates.ImageResourceKey = resourceKey;
      if (!ad.ImageName) updates.ImageName = file.getName();
      if (!ad.ImageMimeType) updates.ImageMimeType = mime;
      if (!ad.ImageSize) updates.ImageSize = file.getSize();
      if (Object.keys(updates).length) { updates.UpdatedAt = nowIso_(); updateById_('Advertisements',ad.Id,updates); repaired++; }
    } catch (error) { missing.push(ad.Reference + ': file unavailable'); }
  });
  return { checked:rows_('Advertisements').filter(x=>x.ImageFileId).length, repaired:repaired, missing:missing };
}

/** Verify Advertisement Images folder permissions and public image delivery from the Apps Script editor. */
function testAdvertisementImageStorageFromEditor() {
  setupSystem();
  const bytes = Utilities.base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlXqLsAAAAASUVORK5CYII=');
  const file = getFolder_('Advertisement Images').createFile(Utilities.newBlob(bytes,'image/png','advertisement-image-test.png'));
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    try { if (file.getSecurityUpdateEligible && file.getSecurityUpdateEligible()) file.setSecurityUpdateEnabled(false); } catch (ignored) {}
    const result = {
      ok:true,
      folder:'Advertisement Images',
      fileId:file.getId(),
      mimeType:file.getMimeType(),
      size:file.getSize(),
      publicUrl:advertisementImageUrl_(file.getId(),safeResourceKey_(file))
    };
    Logger.log(JSON.stringify(result,null,2));
    return result;
  } finally {
    try { file.setTrashed(true); } catch (ignored) {}
  }
}

function savePaymentSlipBlob_(member, uploadBlob) {
  let fileName = String(uploadBlob.getName ? uploadBlob.getName() : 'payment-slip').trim() || 'payment-slip';
  const bytes = uploadBlob.getBytes();
  if (!bytes || !bytes.length) throw new Error('The selected payment slip is empty.');
  if (bytes.length > APP.MAX_SLIP_BYTES) throw new Error('Payment slip must be 5 MB or smaller.');

  let mimeType = String(uploadBlob.getContentType ? uploadBlob.getContentType() : '').toLowerCase().split(';')[0].trim();
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  const detectedMime = sniffAllowedFileMime_(bytes);
  if (!detectedMime) throw new Error('Payment slip content is not a valid JPG, PNG, WebP or PDF file.');
  if (mimeType && mimeType !== 'application/octet-stream' && mimeType !== detectedMime) throw new Error('Payment slip file extension/type does not match its content.');
  mimeType = detectedMime;
  validatePaymentSlipType_(mimeType, fileName);

  const safeName = paymentSlipFileName_(member, fileName, mimeType);
  const blob = Utilities.newBlob(bytes, mimeType, safeName);
  return getFolder_('Payment Slips').createFile(blob);
}

function savePaymentSlip_(member, dataUrl, fileName, mimeType) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const base64 = match ? match[2] : raw;
  mimeType = String(mimeType || (match ? match[1] : '') || mimeFromFileName_(fileName)).toLowerCase().split(';')[0].trim();
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  validatePaymentSlipType_(mimeType, fileName);
  let bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (error) { throw new Error('The payment slip data is invalid. Please select the file again.'); }
  if (!bytes.length) throw new Error('The selected payment slip is empty.');
  if (bytes.length > APP.MAX_SLIP_BYTES) throw new Error('Payment slip must be 5 MB or smaller.');
  const detectedMime = sniffAllowedFileMime_(bytes);
  if (!detectedMime) throw new Error('Payment slip content is not a valid JPG, PNG, WebP or PDF file.');
  if (mimeType && mimeType !== detectedMime) throw new Error('Payment slip file extension/type does not match its content.');
  mimeType = detectedMime;
  const safeName = paymentSlipFileName_(member, fileName, mimeType);
  return getFolder_('Payment Slips').createFile(Utilities.newBlob(bytes, mimeType, safeName));
}

function sniffAllowedFileMime_(bytes) {
  const b = Array.prototype.map.call(bytes || [], x => Number(x) & 255);
  if (b.length >= 4 && b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46) return 'application/pdf';
  if (b.length >= 3 && b[0]===0xFF && b[1]===0xD8 && b[2]===0xFF) return 'image/jpeg';
  if (b.length >= 8 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47 && b[4]===0x0D && b[5]===0x0A && b[6]===0x1A && b[7]===0x0A) return 'image/png';
  if (b.length >= 12 && b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50) return 'image/webp';
  return '';
}

function validatePaymentSlipType_(mimeType, fileName) {
  const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
  if (!allowed.includes(String(mimeType || '').toLowerCase())) {
    throw new Error('Payment slip must be a JPG, JPEG, PNG, WebP or PDF file. Selected file: ' + String(fileName || 'unknown'));
  }
}

function mimeFromFileName_(fileName) {
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  return ({ jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', pdf:'application/pdf' })[ext] || '';
}

function paymentSlipFileName_(member, fileName, mimeType) {
  const extByMime = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'application/pdf':'.pdf' };
  let cleanName = String(fileName || 'payment-slip').replace(/[^A-Za-z0-9._-]/g,'_').replace(/_+/g,'_').slice(-120);
  if (!/\.(jpe?g|png|webp|pdf)$/i.test(cleanName)) cleanName += extByMime[mimeType] || '';
  return member.MembershipNumber + '_' + Date.now() + '_' + cleanName;
}

// ---------- Storage helpers ----------
function getDb_(create) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(APP.DB_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { if (!create) throw new Error('The configured database is unavailable. Run setupSystem() to repair the connection.'); }
  }
  if (!create) throw new Error('System is not initialized. Run setupSystem().');
  const ss = SpreadsheetApp.create('MV Market Database');
  props.setProperty(APP.DB_PROP,ss.getId());
  return ss;
}
function isInitialized_(){try{return !!getDb_(false);}catch(e){return false;}}
function assertInitialized_(){if(!isInitialized_())throw new Error('System is not initialized. Run setupSystem() from Apps Script.');}

/** Safely migrates an existing sheet by header name instead of relabelling columns in place. */
function ensureSheet_(ss,name,headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#dff6f3');
    sh.setFrozenRows(1); return sh;
  }
  const lastColumn = Math.max(1,sh.getLastColumn());
  const existing = sh.getRange(1,1,1,lastColumn).getValues()[0].map(x => String(x || '').trim());
  const exact = headers.length === existing.length && headers.every((h,i) => existing[i] === h);
  if (!exact) {
    const values = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,lastColumn).getValues() : [];
    const positions = {}; existing.forEach((h,i) => { if (h && positions[h] === undefined) positions[h] = i; });
    const migrated = values.map(row => headers.map(h => positions[h] === undefined ? '' : row[positions[h]]));
    sh.clearContents();
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#dff6f3');
    if (migrated.length) sh.getRange(2,1,migrated.length,headers.length).setValues(migrated);
  }
  sh.setFrozenRows(1);
  return sh;
}
function sheet_(name){const sh=getDb_(false).getSheetByName(name);if(!sh)throw new Error('Missing database table: '+name+'. Run setupSystem().');return sh;}
function rows_(name){const sh=sheet_(name),last=sh.getLastRow(),headers=SHEMAS[name];if(last<2)return[];const values=sh.getRange(2,1,last-1,headers.length).getValues();return values.map((r,idx)=>{const o={_row:idx+2};headers.forEach((h,i)=>o[h]=serialize_(r[i]));return o;});}
function append_(name,obj){const headers=SHEMAS[name],sh=sheet_(name);sh.appendRow(headers.map(h=>obj[h]===undefined?'':obj[h]));}
function updateById_(name,id,updates){
  const sh=sheet_(name),headers=SHEMAS[name],idColumn=headers.indexOf('Id')+1;
  if(idColumn<1)throw new Error(name+' table has no Id column.');
  const last=sh.getLastRow(); if(last<2)throw new Error(name+' record not found.');
  const match=sh.getRange(2,idColumn,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if(!match)throw new Error(name+' record not found.');
  const rowNumber=match.getRow(),values=sh.getRange(rowNumber,1,1,headers.length).getValues()[0];
  Object.keys(updates||{}).forEach(function(k){const c=headers.indexOf(k);if(c>=0)values[c]=updates[k]===undefined?'':updates[k];});
  sh.getRange(rowNumber,1,1,headers.length).setValues([values]);
}
function deleteById_(name,id){const sh=sheet_(name),headers=SHEMAS[name],idColumn=headers.indexOf('Id')+1,last=sh.getLastRow();if(last<2||idColumn<1)throw new Error(name+' record not found.');const match=sh.getRange(2,idColumn,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();if(!match)throw new Error(name+' record not found.');sh.deleteRow(match.getRow());}
function findById_(name,id){const sh=sheet_(name),headers=SHEMAS[name],idColumn=headers.indexOf('Id')+1,last=sh.getLastRow();if(last<2||idColumn<1)return null;const match=sh.getRange(2,idColumn,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();if(!match)return null;const values=sh.getRange(match.getRow(),1,1,headers.length).getValues()[0],out={_row:match.getRow()};headers.forEach((h,i)=>out[h]=serialize_(values[i]));return out;}
function nextCounter_(key){const lock=LockService.getScriptLock();const owned=lock.hasLock();if(!owned)lock.waitLock(30000);try{const sh=sheet_('Counters'),all=rows_('Counters'),r=all.find(x=>x.Key===key);if(r){const n=Number(r.Value||0)+1;sh.getRange(r._row,2).setValue(n);return n;}sh.appendRow([key,1]);return 1;}finally{if(!owned)lock.releaseLock();}}
function settingsMap_(){const o={};rows_('Settings').forEach(x=>o[x.Key]=x.Value);return o;}
function upsertSetting_(key,value,type){const sh=sheet_('Settings'),r=rows_('Settings').find(x=>x.Key===key);if(r)sh.getRange(r._row,1,1,3).setValues([[key,value,type||r.Type||'text']]);else sh.appendRow([key,value,type||'text']);}
function seedCounters_(){['ADMIN_ID','MEMBER_ID','MEMBERSHIP','CATEGORY_ID','PACKAGE_ID','AD_ID','AD_REF','PAYMENT_ID','PAYMENT_REF','AUDIT_ID'].forEach(k=>{if(!rows_('Counters').some(x=>x.Key===k))append_('Counters',{Key:k,Value:0});});}
function counterSuffixMax_(values,prefix){return values.reduce((m,v)=>{const match=String(v||'').match(new RegExp('^'+prefix+'\\d{4}-(\\d+)$','i'));return match?Math.max(m,Number(match[1]||0)):m;},0);}
function setCounterMinimum_(key,minValue){const r=rows_('Counters').find(x=>x.Key===key);if(!r){append_('Counters',{Key:key,Value:minValue});return;}if(Number(r.Value||0)<Number(minValue||0))sheet_('Counters').getRange(r._row,2).setValue(Number(minValue||0));}
function repairCounters_(){
  const admins=rows_('Admins'),members=rows_('Members'),cats=rows_('Categories'),packs=rows_('Packages'),ads=rows_('Advertisements'),payments=rows_('Payments'),audit=rows_('AuditLogs');
  const maxId=a=>a.reduce((m,x)=>Math.max(m,Number(x.Id||0)),0);
  setCounterMinimum_('ADMIN_ID',maxId(admins)); setCounterMinimum_('MEMBER_ID',maxId(members)); setCounterMinimum_('CATEGORY_ID',maxId(cats)); setCounterMinimum_('PACKAGE_ID',maxId(packs)); setCounterMinimum_('AD_ID',maxId(ads)); setCounterMinimum_('PAYMENT_ID',maxId(payments)); setCounterMinimum_('AUDIT_ID',maxId(audit));
  setCounterMinimum_('MEMBERSHIP',counterSuffixMax_(members.map(x=>x.MembershipNumber),'MVM-'));
  setCounterMinimum_('AD_REF',counterSuffixMax_(ads.map(x=>x.Reference),'AD-'));
  setCounterMinimum_('PAYMENT_REF',counterSuffixMax_(payments.map(x=>x.Reference),'PAY-'));
}
function seedSettings_(){const defs=[
  ['siteName','MV Market','text'],['shortName','MV Market','text'],['companyEmail',APP.SUPER_ADMIN_EMAIL,'email'],['companyWhatsApp','+960 9282569','text'],['companyPhone','+960 9282569','text'],
  ['primaryColor','#087f8c','color'],['secondaryColor','#13b8a6','color'],['accentColor','#ffb703','color'],['defaultCurrency','MVR','text'],
  ['homeHeading','Find it. Sell it. Make it happen.','text'],['homeDescription','Jobs, properties, vehicles, rentals, electronics and services in one Maldives marketplace.','textarea'],['footerText','Maldives all-in-one classifieds marketplace.','textarea'],
  ['autoRefreshSeconds','30','number'],['registrationEnabled','true','boolean'],['postingEnabled','true','boolean'],['maintenanceMode','false','boolean'],
  ['bankName','','text'],['bankAccountName','','text'],['bankAccountNumber','','text'],['bankBranch','','text'],['paymentInstructions','Transfer the exact package amount and upload a clear payment slip. Use your Membership Number as the payment reference.','textarea']
];const existing=settingsMap_();defs.forEach(x=>{if(existing[x[0]]===undefined)append_('Settings',{Key:x[0],Value:x[1],Type:x[2]});});}
function seedCategories_(){if(rows_('Categories').length)return;const names=[['Jobs','💼'],['Property','🏠'],['Vehicles','🚗'],['Boats and Marine','🚤'],['Electronics','📱'],['Home and Appliances','🛋️'],['Rentals','🎥'],['Services','🛠️'],['Business','🏢'],['Fashion','👕'],['Education','🎓'],['Travel and Tourism','✈️'],['Community','📢'],['Other','◉']];names.forEach((x,i)=>append_('Categories',{Id:nextCounter_('CATEGORY_ID'),Name:x[0],Icon:x[1],DisplayOrder:i+1,Status:'Active',CreatedAt:nowIso_(),UpdatedAt:nowIso_()}));}
function ensureFolders_(){const props=PropertiesService.getScriptProperties();let root;const id=props.getProperty(APP.ROOT_FOLDER_PROP);try{if(id)root=DriveApp.getFolderById(id);}catch(e){}if(!root){root=DriveApp.createFolder('MV Market System Files');props.setProperty(APP.ROOT_FOLDER_PROP,root.getId());}['Website Logo','Payment Slips','Advertisement Images','Member Documents','Invoices','Receipts'].forEach(n=>{const it=root.getFoldersByName(n);if(!it.hasNext())root.createFolder(n);});}
function getFolder_(name){ensureFolders_();const root=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty(APP.ROOT_FOLDER_PROP));const it=root.getFoldersByName(name);return it.hasNext()?it.next():root.createFolder(name);}

// ---------- Website logo / brand helpers ----------
function defaultBrandPayload_() {
  return { siteName:'MV Market', shortName:'MV Market', primaryColor:'#087f8c', secondaryColor:'#13b8a6', accentColor:'#ffb703', registrationEnabled:true, logo:logoPayload_() };
}
function brandPayload_() {
  const s = settingsMap_();
  return {
    siteName:s.siteName || 'MV Market', shortName:s.shortName || s.siteName || 'MV Market',
    primaryColor:s.primaryColor || '#087f8c', secondaryColor:s.secondaryColor || '#13b8a6', accentColor:s.accentColor || '#ffb703',
    registrationEnabled:bool_(s.registrationEnabled), logo:logoPayload_()
  };
}
function logoPayload_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty(APP.LOGO_FILE_PROP) || '';
  if (!fileId) return { exists:false, dataUrl:'', fileName:'', mimeType:'' };
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mimeType = String(blob.getContentType() || props.getProperty(APP.LOGO_MIME_PROP) || '').toLowerCase();
    if (!['image/png','image/jpeg','image/webp'].includes(mimeType)) return { exists:false, dataUrl:'', fileName:'', mimeType:'' };
    const bytes = blob.getBytes();
    if (!bytes.length || bytes.length > APP.MAX_LOGO_BYTES) return { exists:false, dataUrl:'', fileName:'', mimeType:'' };
    return {
      exists:true, fileName:props.getProperty(APP.LOGO_NAME_PROP) || file.getName(), mimeType:mimeType,
      dataUrl:'data:' + mimeType + ';base64,' + Utilities.base64Encode(bytes)
    };
  } catch (e) {
    return { exists:false, dataUrl:'', fileName:'', mimeType:'' };
  }
}

// ---------- Session / security helpers ----------
function createSession_(sheetName,idField,id,hours){const token=randomToken_(48),hash=tokenHash_(token),expires=new Date(Date.now()+hours*3600000).toISOString();append_(sheetName,{TokenHash:hash,[idField]:id,ExpiresAt:expires,CreatedAt:nowIso_()});return token;}
function sessionOwner_(sheetName,idField,token){if(!token)return null;const hash=tokenHash_(token),session=rows_(sheetName).find(x=>x.TokenHash===hash);if(!session)return null;if(new Date(session.ExpiresAt).getTime()<Date.now()){sheet_(sheetName).deleteRow(session._row);return null;}return session[idField];}
function removeSession_(sheetName,token){if(!token)return;const hash=tokenHash_(token),r=rows_(sheetName).find(x=>x.TokenHash===hash);if(r)sheet_(sheetName).deleteRow(r._row);}
function deleteSessionsFor_(sheetName,idField,id){const sh=sheet_(sheetName);rows_(sheetName).filter(x=>Number(x[idField])===Number(id)).sort((a,b)=>b._row-a._row).forEach(x=>sh.deleteRow(x._row));}
function purgeExpiredSessions_(){const now=Date.now();let removed=0;['AdminSessions','MemberSessions'].forEach(name=>{const sh=sheet_(name);rows_(name).filter(x=>!x.ExpiresAt||new Date(x.ExpiresAt).getTime()<now).sort((a,b)=>b._row-a._row).forEach(x=>{sh.deleteRow(x._row);removed++;});});return removed;}
function requireMember_(token){const id=sessionOwner_('MemberSessions','MemberId',token);if(!id)throw new Error('Member session expired. Please login again.');const m=findById_('Members',id);if(!m||m.Status!=='Active')throw new Error('Member account is unavailable.');return m;}
function requireAdmin_(token){const id=sessionOwner_('AdminSessions','AdminId',token);if(!id)throw new Error('Administrator session expired. Please login again.');const a=findById_('Admins',id);if(!a||a.Status!=='Active')throw new Error('Administrator account is unavailable.');return a;}
function requirePermission_(token,permission){const a=requireAdmin_(token);if(bool_(a.MustChangePassword))throw new Error('Change the temporary administrator password before using the dashboard.');if(a.Role!=='Super Administrator'&&!permissionsFor_(a).includes(permission))throw new Error('You do not have permission for this action.');return a;}
function permissionsFor_(admin){if(admin.Role==='Super Administrator')return ALL_PERMISSIONS.slice();try{const p=JSON.parse(admin.Permissions||'[]');return Array.isArray(p)&&p.length?p:(ROLE_PERMISSIONS[admin.Role]||[]);}catch(e){return ROLE_PERMISSIONS[admin.Role]||[];}}
function ensureSuperAdmin_(force){let admin=rows_('Admins').find(x=>normalizeEmail_(x.Email)===normalizeEmail_(APP.SUPER_ADMIN_EMAIL));if(admin&&!force)return'';const password=generatePassword_(),creds=makePassword_(password),now=nowIso_();if(admin)updateById_('Admins',admin.Id,{Name:'Super Administrator',Role:'Super Administrator',Permissions:JSON.stringify(ALL_PERMISSIONS),PasswordSalt:creds.salt,PasswordHash:creds.hash,MustChangePassword:true,Status:'Active',FailedAttempts:0,LockUntil:'',UpdatedAt:now});else append_('Admins',{Id:nextCounter_('ADMIN_ID'),Name:'Super Administrator',Email:APP.SUPER_ADMIN_EMAIL,Role:'Super Administrator',Permissions:JSON.stringify(ALL_PERMISSIONS),PasswordSalt:creds.salt,PasswordHash:creds.hash,MustChangePassword:true,Status:'Active',FailedAttempts:0,LockUntil:'',LastLogin:'',CreatedAt:now,UpdatedAt:now});trySend_(APP.SUPER_ADMIN_EMAIL,'MV Market Super Admin temporary password','Temporary password: '+password+'\nChange it immediately after login.');return password;}
function makePassword_(password){const salt=randomToken_(18);return{salt:salt,hash:hashPassword_(password,salt)};}function verifyPassword_(password,salt,expected){return hashPassword_(password,salt)===String(expected||'');}
function hashPassword_(password,salt){const pepper=PropertiesService.getScriptProperties().getProperty(APP.SECRET_PROP)||'';const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(salt)+'|'+String(password)+'|'+pepper,Utilities.Charset.UTF_8);return Utilities.base64EncodeWebSafe(bytes);}
function tokenHash_(token){const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(token),Utilities.Charset.UTF_8);return Utilities.base64EncodeWebSafe(bytes);}
function validatePassword_(p,strong){if(p.length<(strong?10:8))throw new Error('Password must contain at least '+(strong?10:8)+' characters.');if(strong&&(!/[A-Z]/.test(p)||!/[a-z]/.test(p)||!/[0-9]/.test(p)||!/[^A-Za-z0-9]/.test(p)))throw new Error('Password must include uppercase, lowercase, a number and a special character.');}

// ---------- Output / utility ----------
function categoryRows_(){const ads=rows_('Advertisements'),counts={};ads.forEach(x=>{if(x.Status!=='Deleted')counts[x.Category]=(counts[x.Category]||0)+1;});return rows_('Categories').map(x=>Object.assign({},x,{Count:counts[x.Name]||0}));}
function publicSettings_(s){const keys=['siteName','shortName','companyEmail','companyWhatsApp','companyPhone','primaryColor','secondaryColor','accentColor','defaultCurrency','homeHeading','homeDescription','footerText','autoRefreshSeconds','registrationEnabled','postingEnabled','maintenanceMode'];const out={};keys.forEach(k=>{if(s[k]!==undefined)out[k]=s[k];});return out;}
function publicPackage_(x){return{id:Number(x.Id),name:x.Name,price:Number(x.Price||0),posts:Number(x.Posts||0),validityDays:Number(x.ValidityDays||30),description:x.Description,recommended:bool_(x.Recommended)};}
function publicListing_(x){return{id:Number(x.Id),reference:x.Reference,title:x.Title,category:x.Category,location:x.Location,price:Number(x.Price||0),currency:x.Currency,condition:x.Condition,seller:x.Seller,phone:x.Phone,description:x.Description,image:x.ImageFileId?advertisementImageUrl_(x.ImageFileId,x.ImageResourceKey):x.Image,status:x.Status,verified:bool_(x.Verified),featured:bool_(x.Featured),date:x.Date||x.CreatedAt,createdAt:x.CreatedAt||x.Date||'',updatedAt:x.UpdatedAt||x.CreatedAt||x.Date||''};}
function memberListing_(x){return{id:Number(x.Id),reference:x.Reference,title:x.Title,category:x.Category,location:x.Location,price:Number(x.Price||0),currency:x.Currency,status:x.Status,rejectionReason:x.RejectionReason||'',image:x.ImageFileId?advertisementImageUrl_(x.ImageFileId,x.ImageResourceKey):x.Image,createdAt:x.CreatedAt};}
function memberPayment_(x){return{id:Number(x.Id),reference:x.Reference,packageName:x.PackageName,amount:Number(x.Amount||0),currency:x.Currency,status:x.Status,transactionReference:x.TransactionReference,hasProof:!!x.ProofFileId,adminNote:x.AdminNote||'',createdAt:x.CreatedAt};}
function publicMember_(m,u){return{id:Number(m.Id),membershipNumber:m.MembershipNumber,name:m.Name,email:m.Email,phone:m.Phone,whatsapp:m.WhatsApp,accountType:m.AccountType,status:m.Status,verified:bool_(m.Verified),packageId:Number(m.PackageId||0),package:m.Package||'',packageStart:m.PackageStart||'',packageExpiry:m.PackageExpiry||'',postLimit:u.limit,usedPosts:u.used,remainingPosts:u.remaining,packageActive:u.active,packageReason:u.reason};}
function adminMember_(m){
  const u=memberUsage_(m);
  return {
    Id:Number(m.Id), MembershipNumber:m.MembershipNumber, Name:m.Name, Email:m.Email,
    Phone:m.Phone, WhatsApp:m.WhatsApp, AccountType:m.AccountType, Status:m.Status,
    Verified:bool_(m.Verified), PackageId:Number(m.PackageId||0), Package:m.Package||'',
    PackageStart:m.PackageStart||'', PackageExpiry:m.PackageExpiry||'', PostLimit:Number(m.PostLimit||0),
    CreatedAt:m.CreatedAt||'', UpdatedAt:m.UpdatedAt||'', LastLogin:m.LastLogin||'',
    UsedPosts:u.used, RemainingPosts:u.remaining, PackageActive:u.active, PackageReason:u.reason
  };
}
function sanitizeAdmin_(a){return{Id:Number(a.Id),Name:a.Name,Email:a.Email,Role:a.Role,Permissions:permissionsFor_(a),Status:a.Status,LastLogin:a.LastLogin,MustChangePassword:bool_(a.MustChangePassword)};}
function redactAuditValue_(value) {
  if (Array.isArray(value)) return value.map(redactAuditValue_);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const output = {};
    Object.keys(value).forEach(function(key) {
      if (/^(PasswordSalt|PasswordHash|TokenHash|Password|TemporaryPassword|Secret|FileData)$/i.test(key)) output[key] = '[REDACTED]';
      else output[key] = redactAuditValue_(value[key]);
    });
    return output;
  }
  return value;
}
function scrubAuditText_(text) {
  const raw = String(text == null ? '' : text);
  if (!raw) return raw;
  try { return safeJson_(redactAuditValue_(JSON.parse(raw))); }
  catch (ignored) {
    return raw.replace(/("(?:PasswordSalt|PasswordHash|TokenHash|Password|TemporaryPassword|Secret|FileData)"\s*:\s*)"[^"]*"/gi,'$1"[REDACTED]"');
  }
}
function auditTextContainsSecret_(text) {
  const raw = String(text == null ? '' : text);
  return /"(?:PasswordSalt|PasswordHash|TokenHash|Password|TemporaryPassword|Secret|FileData)"\s*:\s*"(?!\[REDACTED\])[^\"]+"/i.test(raw);
}
function scrubAuditLogs_() {
  if (!isInitialized_()) return 0;
  const logs = rows_('AuditLogs');
  if (!logs.length) return 0;
  let changed = 0;
  const previousValues = [], nextValues = [];
  logs.forEach(function(log) {
    const oldPrevious = String(log.PreviousValue == null ? '' : log.PreviousValue);
    const oldNext = String(log.NewValue == null ? '' : log.NewValue);
    const previous = scrubAuditText_(oldPrevious), next = scrubAuditText_(oldNext);
    if (previous !== oldPrevious || next !== oldNext) changed++;
    previousValues.push([previous]); nextValues.push([next]);
  });
  if (changed) {
    const headers = SHEMAS.AuditLogs, sh = sheet_('AuditLogs');
    sh.getRange(2,headers.indexOf('PreviousValue')+1,logs.length,1).setValues(previousValues);
    sh.getRange(2,headers.indexOf('NewValue')+1,logs.length,1).setValues(nextValues);
  }
  return changed;
}
function audit_(admin,action,entity,recordId,prev,next){append_('AuditLogs',{Id:nextCounter_('AUDIT_ID'),AdminName:admin.Name,AdminEmail:admin.Email,Action:action,Entity:entity,RecordId:String(recordId),PreviousValue:safeJson_(redactAuditValue_(prev)),NewValue:safeJson_(redactAuditValue_(next)),CreatedAt:nowIso_()});}
function notifyAdmins_(subject,body){const recipients=new Set([settingsMap_().companyEmail||APP.SUPER_ADMIN_EMAIL]);rows_('Admins').filter(x=>x.Status==='Active'&&validEmail_(normalizeEmail_(x.Email))).forEach(x=>recipients.add(normalizeEmail_(x.Email)));recipients.forEach(email=>trySend_(email,subject,body));}
function trySend_(to,subject,body){try{MailApp.sendEmail(String(to),String(subject),String(body));return true;}catch(e){Logger.log('Email failed: '+e.message);return false;}}
function errorMessage_(error){return error&&error.message?String(error.message):String(error||'Unknown error');}
function clean_(v,max){return String(v==null?'':v).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max||5000);}function normalizeEmail_(v){return String(v||'').trim().toLowerCase();}function normalizeName_(v){return String(v||'').trim().replace(/\s+/g,' ').toLowerCase();}function validEmail_(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}function bool_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1'||String(v).toLowerCase()==='on';}
function randomToken_(bytes){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'').slice(0,Math.max(0,Number(bytes||32)-32));}function generatePassword_(){return 'Mv!'+Utilities.getUuid().replace(/-/g,'').slice(0,9)+'7a';}
function nowIso_(){return new Date().toISOString();}function today_(){return Utilities.formatDate(new Date(),'Indian/Maldives','yyyy-MM-dd');}function year_(){return Utilities.formatDate(new Date(),'Indian/Maldives','yyyy');}function pad6_(n){return String(n).padStart(6,'0');}function orderSort_(a,b){return Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0)||Number(a.Id||0)-Number(b.Id||0);}function safeJson_(v){try{return typeof v==='string'?v:JSON.stringify(v);}catch(e){return String(v||'');}}function serialize_(v){return v instanceof Date?v.toISOString():v;}