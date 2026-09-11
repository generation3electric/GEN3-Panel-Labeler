import React, { useEffect, useMemo, useRef, useState } from 'react';
import { checkPhoto } from './photoQuality.js';
import { unavailableReasons } from './photoRules.js';

export function usePhotoChecks(files) {
  const [checks, setChecks] = useState(new Map());
  const pendingChecks = useRef(new WeakMap());
  useEffect(() => {
    let cancelled = false;
    setChecks((current) => new Map(files.map((file) => [file, current.get(file) || { status: 'checking', issues: [] }])));
    for (const file of files) {
      if (!pendingChecks.current.has(file)) pendingChecks.current.set(file, checkPhoto(file));
      pendingChecks.current.get(file).then((result) => {
        if (!cancelled) setChecks((current) => current.get(file)?.status !== 'checking' ? current : new Map(current).set(file, result));
      });
    }
    return () => { cancelled = true; };
  }, [files]);
  function update(file, patch) {
    setChecks((current) => new Map(current).set(file, { ...current.get(file), ...patch }));
  }
  return [checks, update];
}

export function PhotoTile({ file, label, onRemove, quality, onQuality }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const dialog = useRef(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const checking = !quality || quality.status === 'checking';
  const warnings = quality?.issues || [];
  return <div className="photoTile">
    <button className="photoPreview" type="button" onClick={() => dialog.current.showModal()} aria-label={`Enlarge ${label}`}>
      <img src={url} alt={label} /><span>Tap to enlarge</span>
    </button>
    <dialog className="photoDialog" ref={dialog} aria-label={label}>
      <button type="button" className="secondary" onClick={() => dialog.current.close()}>Close photo</button>
      <img src={url} alt={label} />
    </dialog>
    <div className="photoTileTitle"><strong>{label}</strong><button type="button" onClick={onRemove}>Remove / retake</button></div>
    <div className={warnings.length ? 'photoQuality warning' : 'photoQuality'} aria-live="polite">
      {checking ? 'Checking photo…' : warnings.length ? <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : 'No obvious quality issues. Check small text yourself.'}
    </div>
    {!checking && <>
      <label className="photoCheck"><input type="checkbox" checked={Boolean(quality.accepted)} onChange={(e) => onQuality({ accepted: e.target.checked, reason: e.target.checked ? quality.reason : '' })} />Keep best available; flag for review</label>
      {quality.accepted && <label className="photoReason">Why can’t this be improved?<input maxLength={300} value={quality.reason || ''} placeholder="e.g. faded lettering on breaker" onChange={(e) => onQuality({ reason: e.target.value })} /></label>}
    </>}
  </div>;
}

export function UnavailablePhoto({ label, value, onChange }) {
  return <div className="unavailablePhoto">
    <label>Photo not available?<select aria-label={`${label} not available reason`} value={value.reason} onChange={(e) => onChange({ reason: e.target.value, details: '' })}>
      <option value="">Select a reason, or take a photo above</option>
      {unavailableReasons.map((reason) => <option key={reason}>{reason}</option>)}
    </select></label>
    {value.reason === 'Other' && <label>Explain why<input aria-label={`${label} other reason`} maxLength={300} value={value.details} onChange={(e) => onChange({ ...value, details: e.target.value })} placeholder="Reason required" /></label>}
  </div>;
}
