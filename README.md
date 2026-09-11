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
- Camera/file capture on mobile
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
