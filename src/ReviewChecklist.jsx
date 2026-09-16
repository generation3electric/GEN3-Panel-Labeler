import React, { useState } from 'react';
import { circuitReady, warningPhoto } from './reviewProgress.js';

export default function ReviewChecklist({ rows, warnings, resolutions, onResolve, onReopen, onPhoto, onUpdate, onKind, onVerify, onDone, kinds, initialCircuit }) {
  const circuits = rows.filter((row) => !row.continuationOf);
  const pending = circuits.filter((row) => row.confidence === 'Review');
  const [mode, setMode] = useState(initialCircuit ? 'circuit' : 'warnings');
  const [activeWarning, setActiveWarning] = useState(null);
  const [activeCircuit, setActiveCircuit] = useState(initialCircuit || pending[0]?.circuit || circuits[0]?.circuit || null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const openWarnings = warnings.filter((warning) => !resolutions[warning]);
  const closedWarnings = warnings.filter((warning) => resolutions[warning]);
  const row = rows.find((item) => item.circuit === activeCircuit);
  function selectCircuit(value) { setActiveCircuit(Number(value)); setError(''); setMessage(''); }
  function verify(next) {
    try {
      onVerify(row.circuit); setError(''); setMessage(`Circuit ${row.circuit} verified.`);
      const remaining = pending.filter((item) => item.circuit !== row.circuit);
      if (next && remaining.length) setActiveCircuit((remaining.find((item) => item.circuit > row.circuit) || remaining[0]).circuit);
      else onDone();
    } catch (err) { setError(err.message); }
  }
  return <section className="reviewChecklist noPrint" aria-label="Review checklist">
    <div className="reviewPopupTabs">
      <button type="button" className="secondary" aria-pressed={mode === 'circuit'} onClick={() => setMode('circuit')}>Circuits ({pending.length})</button>
      <button type="button" className="secondary" aria-pressed={mode === 'warnings'} onClick={() => setMode('warnings')}>Panel warnings ({openWarnings.length})</button>
    </div>
    {mode === 'circuit' && <>
      <label className="reviewCircuitPicker">Circuit<select value={activeCircuit || ''} onChange={(e) => selectCircuit(e.target.value)}>{circuits.map((item) => <option key={item.circuit} value={item.circuit}>Circuit {item.circuit}{item.confidence === 'Verified' ? ' · Verified' : item.confidence === 'Review' ? ' · Needs review' : ''}</option>)}</select></label>
      {row && !row.continuationOf && <div className="reviewIssueEditor" key={row.circuit}>
        <h3>Circuit {row.circuit}</h3>
        <div className="circuitAiNote"><strong>AI note</strong><p>{row.notes || 'Check the circuit description, amperage, and breaker type against the panel.'}</p>{warningPhoto(row.notes) && <button type="button" className="secondary" onClick={() => onPhoto(warningPhoto(row.notes))}>View referenced photo</button>}</div>
        <label>Breaker type<select value={row.breakerKind} onChange={(e) => onKind(row.circuit,e.target.value)}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
        {row.breakerKind !== 'empty' && <><label>Amperage<input type="number" min="1" max="1200" value={row.amps || ''} onChange={(e) => onUpdate(row.circuit,'amps', e.target.value ? Number(e.target.value) : null)} /></label><label>Circuit description<textarea maxLength={280} value={row.description} onChange={(e) => onUpdate(row.circuit,'description',e.target.value)} /></label></>}
        {!circuitReady(row) && <p>Enter the amperage, confirmed breaker type, and description to verify this circuit.</p>}
        <div className="reviewPopupActions"><button className="primary" type="button" disabled={!circuitReady(row)} onClick={() => verify(false)}>Verify & close</button><button className="secondary" type="button" disabled={!circuitReady(row)} onClick={() => verify(true)}>Verify & next</button></div>
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      </div>}
    </>}
    {mode === 'warnings' && <>
      {!activeWarning && <>
        {openWarnings.length === 0 && <p>All panel warnings are resolved.</p>}
        {openWarnings.map((warning) => <article className="reviewWarning" key={warning}><p>{warning}</p><button type="button" className="secondary" onClick={() => { setActiveWarning(warning); setNote(''); }}>Review & correct</button></article>)}
        {closedWarnings.length > 0 && <details className="resolvedWarnings"><summary>Resolved warnings ({closedWarnings.length})</summary>{closedWarnings.map((warning) => <article key={warning}><p>{warning}</p><p><strong>Resolution:</strong> {resolutions[warning].note}</p><button className="secondary" type="button" onClick={() => onReopen(warning)}>Reopen warning</button></article>)}</details>}
      </>}
      {activeWarning && <div className="reviewIssueEditor">
        <button className="secondary" type="button" onClick={() => setActiveWarning(null)}>← All warnings</button>
        <h3>Resolve this warning</h3><p>{activeWarning}</p>
        {warningPhoto(activeWarning) && <button type="button" className="secondary" onClick={() => onPhoto(warningPhoto(activeWarning))}>View referenced photo</button>}
        <label>Correct a circuit<select value="" onChange={(e) => { selectCircuit(e.target.value); setMode('circuit'); }}><option value="">Choose a circuit to edit</option>{circuits.map((item) => <option key={item.circuit} value={item.circuit}>Circuit {item.circuit} · {item.description || 'Unlabeled'}</option>)}</select></label>
        <label>What did you check or correct?<textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Record the correction or how you confirmed the information." /></label>
        <p className="muted">Verify affected breakers in the Circuits tab, then resolve this warning.</p>
        <button type="button" className="primary" disabled={!note.trim()} onClick={() => { onResolve(activeWarning, note); setActiveWarning(null); setNote(''); }}>Resolve warning</button>
      </div>}
    </>}
  </section>;
}
