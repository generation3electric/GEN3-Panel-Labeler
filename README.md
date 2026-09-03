# GEN3 Panel Labeler

Mobile-first field workflow for collecting the information and photos needed to create accurate electrical panel labels.

## Current workflow

- Select a sample job (placeholder for ServiceTitan appointments)
- Confirm customer/location information
- Identify panel name/manufacturer/main breaker/spaces/existing label quality
- Guided required photo sequence
- Camera/file capture on mobile
- Retake photos
- Completion checklist prevents submission with missing required photos
- One-button SharePoint submission
- Job/panel folder creation, photo upload, metadata file, and index entry

## SharePoint connection

The Railway service securely connects to Microsoft Graph. Configure these Railway variables:

- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `SHAREPOINT_HOSTNAME` (defaults to `2155124102.sharepoint.com`)
- `SHAREPOINT_SITE_PATH` (defaults to `/sites/GEN3FieldRecords`)

The Entra application needs Microsoft Graph application access to the GEN3 Field Records site. Prefer `Sites.Selected`; `Sites.ReadWrite.All` also works but grants broader access than this app needs.

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

1. Replace sample jobs with ServiceTitan job/appointment search.
2. Persist panel records and image uploads to backend storage.
3. Add photo quality checks (blur, glare, framing).
4. Add additional-photo workflow for unusual panels and large breaker fields.
5. Process submitted images to detect breaker layout, amperage, labels, tandems, and manufacturer.
6. Add office review for low-confidence AI results.
7. Generate a typed panel directory / homeowner PDF and retain a permanent digital panel record.
