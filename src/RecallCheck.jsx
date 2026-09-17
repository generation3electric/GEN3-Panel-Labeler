import JobNoteStatus from './JobNoteStatus.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_LABELS, IDENTIFIER_FIELDS, applyDecisions } from '../recallCheck.js';
import { recallDraft } from './recallDraft.js';
import './RecallCheck.css';

const labels = { manufacturer: 'Manufacturer / brand', productFamily: 'Product family', model: 'Panel model / catalog number', serialNumber: 'Serial number', dateCode: 'Manufacturing date code', plantCode: 'Plant code', labelText: 'Other text read from the label' };
const blank = () => ({ id: `RC-${Date.now()}-${crypto.randomUUID()}`, stage: 0, panelName: 'Main Panel', job: null, photos: [], labelUnavailable: '', identification: Object.fromEntries(IDENTIFIER_FIELDS.map((key) => [key, ''])), warnings: [], reviewed: false, evidence: '', snapshot: null, decisions: {}, notes: '' });
const localDate = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
async function api(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Your session may have expired. Open the app home page and sign in again; your saved draft will remain on this device.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Please retry.');
  return data;
}
function Header() {
  return <header className="topbar"><a className="brand" href="/"><span className="bolt">⚡</span><span><strong>GEN3</strong><small>Panel Recall Check</small></span></a><a className="recallHistoryLink" href="/recall-check/history">History</a></header>;
}
function Photo({ photo, onRemove }) {
  const url = useMemo(() => photo.file ? URL.createObjectURL(photo.file) : photo.url, [photo.file, photo.url]);
  useEffect(() => () => { if (photo.file) URL.revokeObjectURL(url); }, [url]);
  return <figure className="recallPhoto"><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${photo.role} photo — tap to enlarge`} /></a><figcaption>{photo.role === 'overview' ? 'Overall panel' : photo.role === 'label' ? 'Manufacturer label' : 'Additional label'}{onRemove && <button type="button" onClick={onRemove}>Remove</button>}</figcaption></figure>;
}
function PhotoInput({ role, onAdd, children, disabled }) {
  return <label className={`secondary recallPhotoInput ${disabled ? 'disabled' : ''}`}>{children}<input disabled={disabled} aria-label={children} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAdd(role, file); event.target.value = ''; }} /></label>;
}
function Status({ status }) { return <span className={`recallStatus ${status}`}>{STATUS_LABELS[status] || 'Unable to check'}</span>; }
function Result({ snapshot, decisions = {}, onDecision, status, readOnly = false }) {
  let currentStatus = status || snapshot.status;
  if (!status) { try { currentStatus = applyDecisions(snapshot, decisions).status; } catch {} }
  const message = currentStatus === 'matched' ? 'The technician has documented a match against the official recall criteria. Follow the notice and manufacturer instructions for next steps.' : currentStatus === 'no_match' && snapshot.notices.length ? 'The technician excluded the retrieved notices using the documented criteria below. This is not a safety certification.' : snapshot.message;
  return <div className="recallResults">
    <section className="recallCard"><Status status={currentStatus} /><h2>Recall check results</h2><p>{message}</p><p className="recallNote">Checked {new Date(snapshot.checkedAt).toLocaleString()}. No result in this tool certifies the panel as safe.</p>
      {snapshot.errors?.length > 0 && <p className="recallError">Lookup incomplete. Retry the official search even if a notice below has been reviewed.</p>}
      <details><summary>Sources and search coverage ({snapshot.sources.length})</summary><p>{snapshot.scope}</p><ul>{snapshot.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">CPSC: {new URL(source.url).searchParams.get('ProductName') || new URL(source.url).searchParams.get('Manufacturer') || new URL(source.url).searchParams.get('RecallDescription')}</a><small> Retrieved {new Date(source.retrievedAt).toLocaleString()} · {source.count} notices</small></li>)}</ul></details>
    </section>
    {snapshot.notices.map((notice) => {
      const decision = decisions[notice.id] || { outcome: 'possible' };
      const update = (patch) => onDecision?.(notice.id, { ...decision, ...patch });
      return <article className="recallCard" key={notice.id}>
        <div className="recallNoticeMeta">Recall #{notice.number} · {String(notice.date).slice(0, 10)}</div>
        <h3>{notice.title}</h3><p>{notice.reason}</p>
        {notice.missing.length > 0 && <div className="recallCallout"><strong>More label information may be needed</strong><p>{notice.missing.map((key) => labels[key]).join(' · ')}</p><p>Add these identifiers before confirming a match. Read the official notice for the exact label location and criteria. Only qualified personnel should access labels behind a panel cover.</p></div>}
        <a className="recallSource" href={notice.url} target="_blank" rel="noreferrer">Open official CPSC notice ↗</a>
        {notice.hazard && <p><strong>Hazard:</strong> {notice.hazard}</p>}
        <details><summary>Affected products, remedy, and contact</summary><h4>Affected products</h4><p className="recallSourceText">{notice.description}</p><h4>Remedy</h4><p className="recallSourceText">{notice.remedy}</p><h4>Contact</h4><p>{notice.contact}</p><p className="recallNote">Follow manufacturer instructions linked from the official notice, including any inspection requirements or exceptions.</p></details>
        <div className="recallDecision"><label>Technician finding<select disabled={readOnly} value={decision.outcome || 'possible'} onChange={(e) => update({ outcome: e.target.value })}><option value="possible">Possible match — needs review</option><option value="matched" disabled={notice.missing.length > 0}>Recall criteria matched</option><option value="excluded">Excluded by official criteria</option></select></label>
          {decision.outcome && decision.outcome !== 'possible' && <><p className="recallNote">Confirm each item from the official notice and actual label. If any requirement is unknown, leave this as a possible match.</p>{[['product', 'I verified the affected product and model.'], ['production', 'I verified applicable date, serial, and plant limits (or that none apply).'], ['exclusions', 'I verified exceptions, prior repair markings, and any required manufacturer confirmation.']].map(([key, text]) => <label className="recallCheckline" key={key}><input type="checkbox" disabled={readOnly} checked={!!decision[key]} onChange={(e) => update({ [key]: e.target.checked })} /><span>{text}</span></label>)}<label>Evidence / reason (required)<textarea disabled={readOnly} value={decision.note || ''} maxLength={2000} onChange={(e) => update({ note: e.target.value })} placeholder="Record the actual model, relevant codes, and why the notice applies or excludes this panel." /></label></>}
        </div>
      </article>;
    })}
  </div>;
}
function History() {
  const [items, setItems] = useState([]), [next, setNext] = useState(null), [query, setQuery] = useState(''), [busy, setBusy] = useState(true), [error, setError] = useState(''), [incomplete, setIncomplete] = useState(0);
  async function load(cursor) { setBusy(true); setError(''); try { const data = await api(`/api/recall-checks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); setItems((old) => cursor ? [...old, ...data.records] : data.records); setNext(data.next); setIncomplete((old) => (cursor ? old : 0) + data.incomplete); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  useEffect(() => { load(); }, []);
  const filtered = items.filter((r) => [r.panelName, r.job?.id, r.job?.customer, r.job?.address, r.manufacturer, r.model, r.checkedBy].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <><Header /><main className="content recallPage"><p className="eyebrow">Separate from panel directories</p><h1>Recall Check History</h1><a className="primary recallLinkButton" href="/recall-check">Start or resume a check</a><label className="recallSearch">Search loaded checks<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Customer, address, job, brand, or model" /></label>{error && <div role="alert" className="recallError">{error}<button className="secondary" onClick={() => load(next)}>Retry</button></div>}{incomplete > 0 && <p role="status">{incomplete} records could not be read or have unfinished uploads. Refresh to retry.</p>}{filtered.map((r) => <a className="recallCard recallHistoryCard" href={`/recall-check?id=${encodeURIComponent(r.id)}`} key={r.id}><Status status={r.status} /><h2>{r.panelName}</h2><p>{r.job?.customer || 'Standalone check'}{r.job?.id ? ` · Job #${r.job.id}` : ''}<br />{r.job?.address}</p><p>{r.manufacturer || 'Manufacturer unknown'} · {r.model || 'Model unknown'}</p><small>{new Date(r.checkedAt).toLocaleString()} · {r.checkedBy}</small></a>)}{!busy && !error && !filtered.length && <p>{items.length ? 'No matches among the loaded checks.' : 'No saved recall checks yet.'}</p>}{busy && <p role="status">Loading saved checks…</p>}{next && <button className="secondary" disabled={busy} onClick={() => load(next)}>Load more checks</button>}<p className="recallNote">{items.length} checks loaded{next ? ' · Older checks are available with Load more.' : ''}</p><a href="/">Back to app home</a></main></>;
}
export default function RecallCheck() {
  const history = window.location.pathname.endsWith('/history');
  return history ? <History /> : <Check />;
}
function Check() {
  const recordId = new URLSearchParams(window.location.search).get('id');
  const [draft, setDraft] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [draftState, setDraftState] = useState(''), [online, setOnline] = useState(navigator.onLine);
  const [jobDate, setJobDate] = useState(localDate), [jobs, setJobs] = useState([]), [jobQuery, setJobQuery] = useState(''), [jobError, setJobError] = useState(''), [jobsBusy, setJobsBusy] = useState(false);
  const saveSequence = useRef(Promise.resolve());
  const draftRef = useRef(null); draftRef.current = draft;
  const patch = (changes) => setDraft((old) => ({ ...old, ...changes }));
  useEffect(() => {
    let active = true;
    if (recordId) api(`/api/recall-checks/${encodeURIComponent(recordId)}`).then((r) => active && setSaved(r)).catch((e) => active && setError(e.message));
    else recallDraft('get').then((r) => active && setDraft(r || blank())).catch(() => { if (active) { setDraft(blank()); setDraftState('Draft storage unavailable. Keep this page open until you save.'); } });
    const onOnline = () => setOnline(true), onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { active = false; window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [recordId]);
  useEffect(() => {
    if (!draft || saved) return;
    setDraftState('Saving draft on this device…');
    // Serialize writes so an earlier large photo write cannot replace newer edits.
    saveSequence.current = saveSequence.current.catch(() => {}).then(() => recallDraft('put', draft));
    saveSequence.current.then(() => { if (draftRef.current === draft) setDraftState('Draft saved on this device'); }).catch(() => setDraftState('Draft could not be saved on this device. Keep this page open and retry.'));
  }, [draft, saved]);
  useEffect(() => { const warn = (event) => { if (busy || draftState.includes('Saving') || draftState.includes('could not')) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [busy, draftState]);
  async function run(label, fn) { setBusy(label); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); } }
  function addPhoto(role, file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) { setError('Use JPEG, PNG, or WebP photos under 12 MB. For HEIC, export a JPEG first.'); return; }
    const remaining = role === 'detail' ? draft.photos : draft.photos.filter((p) => p.role !== role);
    if (remaining.length >= 6 || remaining.reduce((n, p) => n + p.file.size, file.size) > 45 * 1024 * 1024) { setError('Use up to six photos totaling no more than 45 MB.'); return; }
    patch({ photos: [...remaining, { role, file }], ...(role === 'label' ? { labelUnavailable: '' } : {}), reviewed: false, evidence: '', snapshot: null, decisions: {} }); setError('');
  }
  function photoForm() { const data = new FormData(); draft.photos.forEach((p) => data.append(p.role, p.file, p.file.name)); return data; }
  async function identify() { await run('Reading label photos. This may take a minute…', async () => { const data = await api('/api/recall-checks/identify', { method: 'POST', body: photoForm() }); patch({ identification: data.identification, warnings: data.warnings, reviewed: false, stage: 1, snapshot: null, evidence: '', decisions: {} }); }); }
  async function lookup() { await run('Checking official recall notices…', async () => { const data = await api('/api/recall-checks/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identification: draft.identification, reviewed: draft.reviewed }) }); patch({ ...data, decisions: {}, stage: 2 }); }); }
  async function save() { await run('Saving photos and recall findings…', async () => {
    const data = photoForm(); data.append('record', JSON.stringify({ id: draft.id, evidence: draft.evidence, decisions: draft.decisions, panelName: draft.panelName, job: draft.job, notes: draft.notes, labelUnavailable: draft.labelUnavailable }));
    const record = await api('/api/recall-checks', { method: 'POST', body: data }); setSaved(record);
    await saveSequence.current.catch(() => {}); await recallDraft('delete').catch(() => {});
    window.history.replaceState(null, '', `/recall-check?id=${encodeURIComponent(record.id)}`);
  }); }
  async function loadJobs() { setJobsBusy(true); setJobError(''); try { const data = await api(`/api/servicetitan/jobs?date=${jobDate}`); setJobs(data.jobs || []); if (!data.jobs?.length) setJobError('No appointments for this date. You can still complete a standalone check.'); } catch (e) { setJobError(e.message); } finally { setJobsBusy(false); } }
  const photosReady = draft?.photos.some((p) => p.role === 'overview') && (draft.photos.some((p) => p.role === 'label') || draft.labelUnavailable.trim());
  const editIdentification = (key, value) => patch({ identification: { ...draft.identification, [key]: value }, reviewed: false, snapshot: null, evidence: '', decisions: {} });
  const decisionValid = !draft?.snapshot || draft.snapshot.notices.every((n) => { const d = draft.decisions[n.id]; return !d || !d.outcome || d.outcome === 'possible' || (d.outcome !== 'matched' || n.missing.length === 0) && d.product && d.production && d.exclusions && d.note?.trim().length >= 10 && draft.identification.manufacturer.trim() && draft.identification.model.trim(); });
  return <><Header /><main className="content recallPage">
    {error && <div className="recallError" role="alert">{error}</div>}
    {saved ? <><p className="eyebrow">Saved recall check</p><h1>{saved.panelName}</h1><p className="lead compact">{saved.job?.customer || 'Standalone panel check'}{saved.job?.id ? ` · Job #${saved.job.id}` : ''}<br />{saved.job?.address}</p><p className="recallNote">Saved by {saved.checkedBy.name} · {new Date(saved.savedAt).toLocaleString()}</p><JobNoteStatus endpoint={`/api/recall-checks/${encodeURIComponent(saved.id)}/job-note`} initial={saved.jobNote} /><section className="recallCard"><h2>Verified label readings</h2><dl className="recallIdentifiers">{IDENTIFIER_FIELDS.filter((key) => key !== 'labelText').map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{saved.snapshot.identification[key] || 'Not available'}</dd></div>)}</dl>{saved.labelUnavailable && <p>Label unavailable: {saved.labelUnavailable}</p>}<div className="recallPhotos">{saved.photos.map((p) => <Photo key={p.name} photo={p} />)}</div>{saved.notes && <p>Notes: {saved.notes}</p>}</section><Result snapshot={saved.snapshot} decisions={saved.decisions} status={saved.status} readOnly /><div className="recallActions"><a className="primary recallLinkButton" href="/recall-check">Start another check</a><a className="secondary recallLinkButton" href="/recall-check/history">Recall Check History</a></div></> : !draft ? (!error && <p role="status">Loading recall check…</p>) : <>
      <p className="eyebrow">Independent field workflow</p><h1>Panel Recall Check</h1><p className="lead compact">Photograph the labels, confirm the identifiers, and check official U.S. recall notices.</p>
      <div className="recallSteps" aria-label="Progress">{['Photos', 'Identification', 'Results'].map((text, i) => <span key={text} aria-current={draft.stage === i ? 'step' : undefined}>{i + 1}. {text}</span>)}</div>
      <p className="recallDraftState" role="status">{draftState}{!online ? ' · Offline: internet is needed to read photos, check recalls, and save to history.' : ''}</p>
      {busy && <div className="recallBusy" role="status"><span className="recallSpinner" />{busy}</div>}
      <fieldset disabled={!!busy} className="recallFieldset">
      {draft.stage === 0 && <>
        <section className="recallCard"><h2>1. Panel and job</h2><label>Panel name<input value={draft.panelName} maxLength={200} onChange={(e) => patch({ panelName: e.target.value })} /></label>
          <details><summary>{draft.job ? `Linked to Job #${draft.job.id} · ${draft.job.customer}` : 'Link to a ServiceTitan job (optional)'}</summary>{draft.job && <p>{draft.job.address}<button className="secondary" type="button" onClick={() => patch({ job: null })}>Remove job link</button></p>}<div className="recallJobControls"><label>Appointment date<input type="date" value={jobDate} onChange={(e) => { setJobDate(e.target.value); setJobs([]); }} /></label><button className="secondary" disabled={jobsBusy || !online} type="button" onClick={loadJobs}>{jobsBusy ? 'Loading…' : 'Load jobs'}</button></div>{jobError && <p role="status">{jobError}</p>}{jobs.length > 0 && <><label>Find a job<input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="Name, address, or job number" /></label><div className="recallJobList">{jobs.filter((job) => [job.id, job.customer, job.address].join(' ').toLowerCase().includes(jobQuery.toLowerCase())).map((job) => <button type="button" className="recallJob" key={job.serviceTitanId || job.id} onClick={() => patch({ job })}><strong>{job.customer} · #{job.id}</strong><span>{job.address}</span></button>)}</div></>}</details>
        </section>
        <section className="recallCard"><h2>2. Overall panel photo</h2><p>Show the panel and its installed breakers.</p>{draft.photos.filter((p) => p.role === 'overview').map((p) => <Photo key={p.role} photo={p} onRemove={() => patch({ photos: draft.photos.filter((x) => x !== p), reviewed: false, snapshot: null, evidence: '', decisions: {} })} />)}<PhotoInput role="overview" onAdd={addPhoto}>Take or replace overview</PhotoInput></section>
        <section className="recallCard"><h2>3. Manufacturer label</h2><p>Get the panel model/catalog number in focus. Include the date, serial, and plant codes where available. Breaker and cover numbers may differ from the panel model.</p>{draft.photos.filter((p) => p.role === 'label').map((p) => <Photo key={p.role} photo={p} onRemove={() => patch({ photos: draft.photos.filter((x) => x !== p), reviewed: false, snapshot: null, evidence: '', decisions: {} })} />)}<PhotoInput role="label" onAdd={addPhoto}>Take or replace label photo</PhotoInput>{!draft.photos.some((p) => p.role === 'label') && <label>Label unavailable?<select value={draft.labelUnavailable} onChange={(e) => patch({ labelUnavailable: e.target.value, reviewed: false, snapshot: null, evidence: '', decisions: {} })}><option value="">Select only if a photo cannot be taken</option><option>Label missing</option><option>Label damaged or unreadable</option><option>Label inaccessible without further work</option></select></label>}
          <div className="recallPhotos">{draft.photos.filter((p) => p.role === 'detail').map((p, i) => <Photo key={i} photo={p} onRemove={() => patch({ photos: draft.photos.filter((x) => x !== p), reviewed: false, snapshot: null, evidence: '', decisions: {} })} />)}</div><PhotoInput role="detail" onAdd={addPhoto} disabled={draft.photos.length >= 6 || draft.photos.filter((p) => p.role === 'detail').length >= 4}>Add date / serial / other label photo</PhotoInput>
        </section>
        <div className="recallActions"><button className="primary" disabled={!photosReady || !online} type="button" onClick={identify}>Read labels with AI</button><button className="secondary" disabled={!photosReady} type="button" onClick={() => patch({ stage: 1 })}>Enter or review details manually</button></div><p className="recallNote">AI reads visible text only. You will verify the readings before the recall search.</p>
      </>}
      {draft.stage === 1 && <><section className="recallCard"><h2>Confirm label readings</h2><p>Correct any misread characters. Leave missing identifiers blank. Use the panel model, not a replacement cover or individual breaker model.</p><div className="recallPhotos">{draft.photos.map((p, i) => <Photo key={i} photo={p} />)}</div>{draft.warnings.length > 0 && <ul className="recallCallout">{draft.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul>}<div className="formGrid">{IDENTIFIER_FIELDS.map((key) => <label key={key}>{labels[key]}{key === 'labelText' ? <textarea value={draft.identification[key]} maxLength={6000} onChange={(e) => editIdentification(key, e.target.value)} /> : <input autoCapitalize={key === 'manufacturer' ? 'words' : 'characters'} autoCorrect="off" value={draft.identification[key]} maxLength={200} onChange={(e) => editIdentification(key, e.target.value)} placeholder="Leave blank if unavailable" />}</label>)}</div><label className="recallCheckline"><input type="checkbox" checked={draft.reviewed} onChange={(e) => patch({ reviewed: e.target.checked })} /><span>I checked these readings against the labels and left unavailable information blank.</span></label></section><div className="recallActions"><button type="button" className="secondary" onClick={() => patch({ stage: 0 })}>Back to photos</button><button type="button" className="primary" disabled={!draft.reviewed || !online} onClick={lookup}>Check official recalls</button></div></>}
      {draft.stage === 2 && draft.snapshot && <><Result snapshot={draft.snapshot} decisions={draft.decisions} onDecision={(id, decision) => patch({ decisions: { ...draft.decisions, [id]: decision } })} /><section className="recallCard"><label>Follow-up notes<textarea value={draft.notes} maxLength={4000} onChange={(e) => patch({ notes: e.target.value })} placeholder="Customer follow-up, manufacturer contact, or another label needed" /></label><p className="recallNote">Saving retains the photos, confirmed identifiers, notices, check date, and your findings in Recall Check History. Possible matches may be saved for follow-up.</p></section>{!decisionValid && <p className="recallError">Complete all verification boxes and an evidence note for each confirmed match or exclusion, or leave it as a possible match.</p>}<div className="recallActions"><button type="button" className="secondary" onClick={() => patch({ stage: 1 })}>Correct details / add photos</button><button type="button" className="secondary" disabled={!online} onClick={lookup}>Recheck official sources</button><button type="button" className="primary" disabled={!online || !decisionValid} onClick={save}>Save recall check</button></div></>}
      </fieldset>
      <div className="recallFooter"><a href="/">Back to app home</a><button type="button" className="recallTextButton" disabled={!!busy} onClick={async () => { if (window.confirm('Discard this unsaved recall check and its draft photos?')) { await saveSequence.current.catch(() => {}); patch(blank()); } }}>Discard draft</button></div>
    </>}
  </main></>;
}
