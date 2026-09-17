# GEN3 Panel Labeler

Mobile-first field workflow for collecting the information and photos needed to create accurate electrical panel labels.

## Current workflow

- Select a live ServiceTitan appointment and its linked job, customer, and service location
- Confirm customer/location information
- Identify panel name/manufacturer/main breaker/spaces/existing label quality
- Panel-size photo guidance: about seven breaker spaces per close-up per side (12 spaces: one per side; 30/42: three per side), with flexible count after coverage confirmation
- Manufacturer and existing directory photos, or explicit missing/damaged/inaccessible/other reasons
- Offline image screening for possible blur, glare, darkness, low contrast, and low resolution; enlarge photos to verify readability
- Best-available photo exceptions require a reason and remain visible in AI review; checks and reasons are saved in the panel record
- One-tap “Flip panel 180°” button in panel setup and review; tap again to flip back. Keeps text upright and circuit descriptions attached, saves with review progress and final records, and updates the physical view and printed directory. Existing saved orientations are preserved until flipped; new records start at top left.
- Panel-first review screen: tap a breaker’s AI note to edit and verify in a pop-up; compact buttons open remaining panel warnings and photos
- Actionable review checklist: open referenced photos, correct circuits individually, verify and advance, resolve warnings with notes, and reopen resolved warnings
- Review corrections and warning resolutions autosave to the device and SharePoint, with visible save/retry status; final records retain the warning-resolution history
- Camera/file capture on mobile
- All Photos gallery in capture review, AI verification, final directories, Past Jobs, and Pending / Recently Uploaded; enlarge, zoom, and step through photos without leaving the app
- Pending photos can be viewed offline on the capturing device; uploaded photos load from SharePoint when online
- Retake photos
- Completion checklist prevents submission with missing required photos
- One-button SharePoint submission
- Job/panel folder creation, photo upload, metadata file, and index entry
- Offline queue with automatic retry plus a Pending / Recently Uploaded screen
- One-tap return from a completed background upload to the saved AI verification result
- Verified corrections, verifier identity, and a generated final PDF saved into the panel's SharePoint record

## SharePoint connection

The Railway service securely connects to Microsoft Graph. Configure these Railway variables:

- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `SHAREPOINT_HOSTNAME` (defaults to `2155124102.sharepoint.com`)
- `SHAREPOINT_SITE_PATH` (defaults to `/sites/GEN3FieldRecords`)

The Entra application needs Microsoft Graph application access to the GEN3 Field Records site. Prefer `Sites.Selected`; `Sites.ReadWrite.All` also works but grants broader access than this app needs.

## ServiceTitan connection

The job picker loads appointments for the selected date, then resolves the linked ServiceTitan job, customer, and service location. Configure these Railway variables:

- `SERVICETITAN_APP_KEY`
- `SERVICETITAN_CLIENT_ID`
- `SERVICETITAN_CLIENT_SECRET`
- `SERVICETITAN_TENANT_ID`

The ServiceTitan application needs read access to Jobs, Appointments, Customers, and Locations. Successfully loaded dates are cached on the device so a technician can select a job after entering a basement dead zone.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Next milestones

1. Calibrate local quality thresholds against real field photographs and device cameras. These screens do not perform OCR or prove legibility.
2. Add office review routing for low-confidence AI results.

## Standalone Panel Recall Check

Start from **Panel Recall Check** on the home screen or `/recall-check`. This is
independent of breaker directories and the Panel Record Index. Technicians can
optionally select a real ServiceTitan appointment, capture an overview and label
photos (or document a missing label), review AI-transcribed identifiers, search
CPSC, and save the findings. `/recall-check/history` lists the saved checks with
pagination, search within loaded records, source notices, and original photos.

- Uses the existing Microsoft employee gateway and OpenAI/SharePoint settings;
  no new secret, database, list, or permission is required.
- Saves a manifest and photos to `Recall Checks/<check-id>/` in the existing
  SharePoint document library. The manifest is written last; incomplete uploads
  are not represented as successful saves. Duplicate identical submissions are
  idempotent, and conflicting reuse of a saved ID is rejected.
- IndexedDB keeps one unsaved draft, including photos, on the device. Reading AI
  labels, searching official notices, and saving shared history require internet.
  Draft storage errors remain visible; there is no automatic offline recall lookup.
- CPSC searches use product categories plus manufacturer aliases and descriptions.
  The server caches successful responses for up to one hour; results retain each
  source query and retrieval timestamp. Any failed query makes the lookup
  incomplete, never a negative finding. A missing brand or missing model cannot
  produce an automatic no-match result.
- Brand/model discovery is deliberately conservative. It includes potentially
  relevant breaker notices as well as panel notices. It never automatically
  declares a match from a model token alone. The technician must verify product,
  production limits, exceptions, and any required manufacturer inspection before
  recording a match or exclusion, with an evidence note.
- Manufacturer-only safety bulletins, general condition concerns, and proof of
  electrical safety are outside the CPSC search scope. Links to official notices
  include manufacturer follow-up instructions. `No matching recall found` is
  limited to the recorded sources and criteria; it is not a safety certification.
- Lookup snapshots are signed server-side so a modified client cannot save a
  forged recall status or source response. Checked-by identity is supplied by the
  authenticated gateway, not a user-editable name field.

Official interface documentation:
https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information

Validation: `npm test` covers partial-feed failures, missing identifiers, official
source validation, technician confirmation requirements, evidence tampering,
image validation, separate save/read behavior, idempotent retries, and interrupted
uploads. `npm run build` creates the production client.

## Panel Inspection — first field-trial version

`/panel-inspection` is a separate workflow with its own draft and saved history at
`/panel-inspection/history`. The quick Recall Check and panel directory tools remain
available. Link a ServiceTitan job or start a standalone inspection, capture an
overall view, interior, manufacturer label, surroundings, and optional close-ups.
Unavailable views require a reason; the overall view is required. The browser
prepares JPEG copies (up to 3000 pixels) without cropping and retains them in an
IndexedDB draft. Up to ten images may be used.

AI suggests visible observations with numbered photo markers. A technician can
correct, confirm, dismiss with a reason, add findings, or move markers on the
original photo. Manual review works without AI. Signed AI evidence binds the
suggestions to the exact uploaded photos; original suggestions remain in the
saved audit record. AI never establishes electrical safety or code compliance.

Manufacturing evidence is separate from installation evidence. Automatic decoding
initially supports verified modern Square D QO/Homeline enclosure or interior
six-digit YYWWDS codes, per Schneider FAQ FA274608. Breaker/cover dates, unsupported
formats and future/invalid codes stay unknown. Other panels support documented
manufacturing year ranges with technician-supplied evidence. Appearance alone does
not establish age, remaining life, or replacement need.

The condition summary follows confirmed findings: urgent, repairs recommended,
attention needed, or no visible concerns identified. Unreviewed findings, missing
views, scope gaps, unanswered symptom questions, and unresolved photo limitations
keep completeness separate and visible. Serious findings are not averaged away.
Incomplete inspections can be saved for follow-up but cannot earn the clear
summary. Recall status remains separate, uses the existing signed CPSC lookup,
and must be refreshed after identifier changes or after 24 hours.

The existing employee gateway identifies the reviewer. The existing SharePoint
library holds `Panel Inspections/<inspection-id>/` with prepared photos, a
customer PDF, and an immutable JSON record written last. Save retries are
idempotent; a conflicting saved ID is rejected. Office review is a history filter,
not an automatic message or assignment. History searches the records loaded so
far and offers pagination. No new environment variables or credentials are needed.
Shared saves, AI review, and recalls require internet. A local draft can be edited
offline once the app is loaded; device storage is not a substitute for a shared save.

Validation: `npm test` covers age evidence, condition and completeness rules,
review requirements, photo/analysis binding, failed uploads, idempotency, PDF
creation, history and photo access. DOM flow checks exercised capture through
technician review, marker placement, failed-save recovery and report access with
mocked services. The generated PDF was rendered for layout review. Live AI and
SharePoint end-to-end testing requires an authenticated field trial.

## ServiceTitan report links in job notes

Saving a **Panel Inspection**, **Recall Check**, or **final verified directory**
now attempts to add a job note after the report files have saved successfully.
The note includes the panel, job number, reviewing technician, original completion
time (Philadelphia), a report link, and a link to saved photos/files. Inspection
and directory links open the saved SharePoint PDF; recall links open the saved
check in the employee app. Existing Microsoft/SharePoint permissions still apply.

The ServiceTitan integration requires **Jobs read and write** scopes
(`tn.jpm.jobs:r`, `tn.jpm.jobs:w`). The endpoint is
`POST /jpm/v2/tenant/{tenant}/jobs/{id}/notes`; see the
[official Create Job Note API](https://developer.servicetitan.io/docs/apis/tenant-jpm-v2/endpoints/Jobs_CreateNote).
Existing connection variables and `AUTH_PUBLIC_URL` are reused.

Only a real `job.serviceTitanId` is used. Standalone and historical-location
records are saved without a note. The app never substitutes a displayed job number
or location ID. Initial directory photo uploads wait for final verification.

Each saved report shows **ServiceTitan job note** delivery status and an explicit
retry action. Older reports can be opened from history and linked with **Add report
link to job notes**. Failed note delivery does not fail or erase the saved report.
Receipts live separately under `ServiceTitan Job Notes` in the existing SharePoint
library. Retries scan all job-note pages for a stable report marker before posting;
concurrent requests are serialized locally and with an atomic SharePoint folder lock.
Expired locks from interrupted deployments can be reclaimed after ten minutes.

A timeout or server error after posting can mean the note was accepted. Those
receipts stay **uncertain** and **Check delivery** only searches for the existing
note; it does not blindly resend. If a note never appears, the office must confirm
the outcome before an administrator resets that receipt. There is no background
retry worker. Repeated finalization uses the same permanent PDF link and does not
add another note for that same panel record.
