import React, { useEffect, useRef, useState } from 'react';
import { WORKFLOWS, TARGET_ROLES, matchingJob, suggestAssignments, validateAssignments } from './sharedPhotoModel.js';
import { HISTORY_URLS, readJson, summarize, localPhotoSources, sourceDetails, importPhotos } from './sharedPhotoLibrary.js';
import './SharedPhotoPicker.css';

function Thumbnail({ photo }) {
  const [url, setUrl] = useState(photo.url);
  useEffect(() => { if (!photo.file) return; const value = URL.createObjectURL(photo.file); setUrl(value); return () => URL.revokeObjectURL(value); }, [photo.file]);
  return <img src={url} alt={`Saved ${photo.role} photo`} loading="lazy" />;
}
export default function SharedPhotoPicker({ target, job, panelName, existing = [], excludeId, onImport }) {
  const [open, setOpen] = useState(false), [sources, setSources] = useState([]), [cursors, setCursors] = useState({});
  const [selected, setSelected] = useState(null), [assignments, setAssignments] = useState({}), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [warnings, setWarnings] = useState([]), [query, setQuery] = useState(''), [allJobs, setAllJobs] = useState(false), [notice, setNotice] = useState('');
  const controller = useRef(null), mounted = useRef(true), latest = useRef(existing), importer = useRef(onImport); latest.current = existing; importer.current = onImport;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function load(more = false) {
    setBusy('Looking for saved photos…'); setError(''); setSelected(null); setConfirmed(false);
    controller.current?.abort(); controller.current = new AbortController(); const signal = controller.current.signal;
    const failures = [], found = [], next = {};
    try {
      if (!more) { const local = await localPhotoSources(); found.push(...local.sources); failures.push(...local.warnings); }
      if (navigator.onLine) {
        const kinds = Object.keys(WORKFLOWS).filter(k => !more || cursors[k]);
        const results = await Promise.allSettled(kinds.map(async kind => {
          const cursor = more ? cursors[kind] : '';
          const data = await readJson(`${HISTORY_URLS[kind]}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
          return { kind, data };
        }));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            const { kind, data } = r.value; found.push(...data.records.map(v => summarize(kind, v))); next[kind] = data.next;
            if (data.incomplete) failures.push(`${WORKFLOWS[kind]}: some records could not be read.`);
          } else { failures.push(`${WORKFLOWS[kinds[i]]} could not be loaded. Refresh to retry.`); if (more) next[kinds[i]] = cursors[kinds[i]]; }
        });
      } else failures.push('Offline: showing photos already saved on this device. Connect to load shared history.');
      if (signal.aborted || !mounted.current) return;
      setSources(old => [...new Map([...(more ? old : []), ...found].filter(s => !(s.kind === target && (s.id === excludeId || s.recordId === excludeId))).map(s => [s.key, s])).values()].sort((a, b) => String(b.date).localeCompare(String(a.date))));
      setCursors(next); setWarnings(failures);
    } catch (e) { if (!signal.aborted && mounted.current) setError(e.message); }
    finally { if (!signal.aborted && mounted.current) setBusy(''); }
  }
  async function choose(source) {
    setBusy('Opening panel photos…'); setError(''); setConfirmed(false);
    controller.current?.abort(); controller.current = new AbortController(); const signal = controller.current.signal;
    try { const detail = await sourceDetails(source, signal); if (mounted.current && !signal.aborted) { setSelected(detail); setAssignments(suggestAssignments(detail, target, latest.current)); } }
    catch (e) { if (mounted.current && !signal.aborted) setError(e.message); }
    finally { if (mounted.current && !signal.aborted) setBusy(''); }
  }
  async function usePhotos() {
    if (!confirmed) return;
    setBusy('Copying selected photos…'); setError('');
    controller.current = new AbortController(); const signal = controller.current.signal;
    try {
      const photos = await importPhotos(selected, target, assignments, latest.current, signal);
      if (signal.aborted || !mounted.current) return;
      validateAssignments(target, selected.photos, assignments, latest.current);
      await importer.current({ source: selected, photos });
      if (mounted.current) { setNotice(`${photos.length} existing photo${photos.length === 1 ? '' : 's'} filled in. Review them below and add any missing views.`); setOpen(false); setSelected(null); }
    } catch (e) { if (mounted.current && !signal.aborted) setError(e.message); }
    finally { if (mounted.current && !signal.aborted) setBusy(''); }
  }
  const filtered = sources.filter(s => (!job || allJobs || matchingJob(job, s.job)) && [s.panelName, s.job?.id, s.job?.customer, s.job?.address, WORKFLOWS[s.kind]].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section className="sharedPhotoPicker" aria-label="Reuse panel photos">
    <h2>Already photographed this panel?</h2><p>Reuse photos from Panel Labeler, Recall Check, or Panel Inspection. Matching empty slots are selected for you.</p>
    {notice && <p role="status">{notice}</p>}
    {!open ? <button type="button" className="secondary" onClick={() => { setOpen(true); load(); }}>Use existing panel photos</button> : <>
      <div className="sharedPhotoActions"><button className="secondary" type="button" disabled={!!busy} onClick={() => load()}>Refresh photos</button><button className="secondary" type="button" disabled={!!busy} onClick={() => { setOpen(false); setSelected(null); }}>Close</button></div>
      {busy && <p role="status">{busy}</p>}{error && <p className="sharedPhotoError" role="alert">{error}</p>}
      {warnings.map((v, i) => <p className="sharedPhotoWarning" key={i}>{v}</p>)}
      {!selected ? <>
        <label>Find a saved panel<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Panel, customer, job number, or address" /></label>
        {job && <label className="sharedPhotoCheck"><input type="checkbox" checked={allJobs} onChange={e => setAllJobs(e.target.checked)} />Include other jobs and earlier visits</label>}
        <div className="sharedPhotoSources">{filtered.map(s => <button type="button" className="sharedPhotoSource" disabled={!!busy} key={s.key} onClick={() => choose(s)}><strong>{s.panelName}</strong><span>{WORKFLOWS[s.kind]} · {s.local ? 'On this device' : 'Shared record'}</span><span>{s.job?.customer}{s.job?.id ? ` · Job #${s.job.id}` : ' · No job linked'}</span><span>{s.job?.address}</span><small>Record date: {s.date ? new Date(s.date).toLocaleString() : 'Not recorded'} · Confirm when the photos were taken</small></button>)}</div>
        {!busy && !filtered.length && <p>No matching panels among the loaded records. {job && !allJobs ? 'Include other jobs to find an earlier visit, or load more records.' : 'Refresh or load more records to look further back.'}</p>}
        {Object.values(cursors).some(Boolean) && <button className="secondary" type="button" disabled={!!busy} onClick={() => load(true)}>Load more saved panels</button>}
      </> : <>
        <h3>{selected.panelName} · {WORKFLOWS[selected.kind]}</h3><p>{selected.job?.address} {selected.job?.id && `· Job #${selected.job.id}`}<br />Record date: {selected.date ? new Date(selected.date).toLocaleString() : 'Not recorded'}</p>
        {job && !matchingJob(job, selected.job) && <p className="sharedPhotoWarning">This comes from a different job or visit. Your current job will stay selected. Confirm this is the same physical panel.</p>}
        <p>Choose where each photo belongs. Existing photos stay in place. Breaker close-ups need a left/right assignment for a directory.</p>
        <div className="sharedPhotoGrid">{selected.photos.map(p => <div key={p.key}><Thumbnail photo={p}/>{p.source?.sourceDate && <small>Original source date: {new Date(p.source.sourceDate).toLocaleString()}</small>}<label>Use photo as<select disabled={!!busy} value={assignments[p.key] || ''} onChange={e => { setAssignments(v => ({ ...v, [p.key]: e.target.value })); setConfirmed(false); }}><option value="">Don’t use</option>{Object.entries(TARGET_ROLES[target]).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>)}</div>
        <label className="sharedPhotoCheck"><input type="checkbox" disabled={!!busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />These photos show {panelName || 'this panel'} in its current condition, and I checked the selected photo requirements.</label>
        <div className="sharedPhotoActions"><button type="button" className="secondary" disabled={!!busy} onClick={() => { setSelected(null); setConfirmed(false); }}>Choose another panel</button><button type="button" className="primary" disabled={!!busy || !confirmed || !Object.values(assignments).some(Boolean)} onClick={usePhotos}>Use selected photos</button></div>
      </>}
    </>}
  </section>;
}
