import React from 'react';
import { NUMBERING_ORIGINS, normalizeNumberingOrigin } from './panelLayout.js';

export default function NumberingOriginSelect({ value, onChange }) {
  return <label className="numberingOriginControl">Circuit #1
    <select aria-label="Circuit number 1 location" value={normalizeNumberingOrigin(value)} onChange={(event) => onChange(event.target.value)}>
      {NUMBERING_ORIGINS.map((origin) => <option key={origin.value} value={origin.value}>{origin.label}</option>)}
    </select>
  </label>;
}
