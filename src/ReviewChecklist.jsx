import React, { useEffect, useRef, useState } from 'react';
import { circuitReady, warningPhoto } from './reviewProgress.js';

export default function ReviewChecklist({ rows, warnings, resolutions, onResolve, onReopen, onPhoto, onUpdate, onKind, onVerify, kinds }) {
  const [activeWarning, setActiveWarning] = useState(null);
  const [activeCircuit, setActiveCircuit] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const editor = useRef(null);
  useEffect(() => { editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [activeWarning, activeCircuit]);
  const pending = rows.filter((row) => row.confidence === 'Review' && !row.continuationOf);
  const openWarnings = warnings.filter((warning) => !resolutions[warning]);
  const closedWarnings = warnings.filter((warning) => resolutions[warning]);
  const row = rows.find((item) => item.circuit === activeCircuit);
  function openWarning(warning) { setActiveWarning(warning); setNote(''); setError(''); setActiveCircuit(null); }
  function verify() {
    try { onVerify(row.circuit); setError(''); setActiveCircuit(pending.find((item) => item.circuit !== row.circuit)?.circuit || null); }
    catch (err) { setError(err.message); }
  }
  return <section className="reviewChecklist noPrint" aria-label="Review checklist">
    <div className="reviewNotice"><strong>{pending.length} breakers need a closer look.</strong><span>Open a circuit, check its details, then mark it verified.</span></div>
    <div className="reviewCircuitLinks">{pending.map((item) => <button type="button" className="secondary" key={item.circuit} onClick={() => { setActiveCircuit(item.circuit); setError(''); }}>Circuit {item.circuit}</button>)}</div>
    <h2>AI warnings · {openWarnings.length} remaining</h2>
    {openWarnings.map((warning) => <article className="reviewWarning" key={warning}><p>{warning}</p><button type="button" className="secondary" onClick={() => openWarning(warning)}>Review & correct</button></article>)}
    {(activeWarning || row) && <div ref={editor} className="reviewEditorAnchor" />}
    {activeWarning && <div className="reviewIssueEditor">
      <h3>Resolve this warning</h3><p>{activeWarning}</p>
      {warningPhoto(activeWarning) && <button type="button" className="secondary" onClick={() => onPhoto(warningPhoto(activeWarning))}>View referenced photo</button>}
      <label>Correct a circuit<select value={activeCircuit || ''} onChange={(e) => setActiveCircuit(Number(e.target.value) || null)}><option value="">Choose the circuit shown in the photo</option>{rows.filter((item) => !item.continuationOf).map((item) => <option key={item.circuit} value={item.circuit}>Circuit {item.circuit} · {item.description || 'Unlabeled'}</option>)}</select></label>
      <label>What did you check or correct?<textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Record the correction or how you confirmed the information." /></label>
      <p className="muted">Resolving a warning keeps its history. Verify any affected breakers separately below.</p>
      <button type="button" className="primary" disabled={!note.trim()} onClick={() => { onResolve(activeWarning, note); setActiveWarning(null); setNote(''); }}>Resolve warning</button>
    </div>}
    {row && !row.continuationOf && <div className="reviewIssueEditor" key={row.circuit}>
      <h3>Correct circuit {row.circuit}</h3>{row.notes && <p>AI note: {row.notes}</p>}
      <label>Breaker type<select value={row.breakerKind} onChange={(e) => onKind(row.circuit,e.target.value)}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
      {row.breakerKind !== 'empty' && <><label>Amperage<input type="number" min="1" max="1200" value={row.amps || ''} onChange={(e) => onUpdate(row.circuit,'amps', e.target.value ? Number(e.target.value) : null)} /></label><label>Circuit description<textarea maxLength={280} value={row.description} onChange={(e) => onUpdate(row.circuit,'description',e.target.value)} /></label></>}
      {!circuitReady(row) && <p>Enter the amperage, confirmed breaker type, and description to verify this circuit.</p>}
      <button className="primary" type="button" disabled={!circuitReady(row)} onClick={verify}>Mark verified & next</button>
      {error && <p role="alert">{error}</p>}
    </div>}
    {closedWarnings.length > 0 && <details className="resolvedWarnings"><summary>Resolved warnings ({closedWarnings.length})</summary>{closedWarnings.map((warning) => <article key={warning}><p>{warning}</p><p><strong>Resolution:</strong> {resolutions[warning].note}</p><button className="secondary" type="button" onClick={() => onReopen(warning)}>Reopen warning</button></article>)}</details>}
  </section>;
}
