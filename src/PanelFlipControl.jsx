import React from 'react';
import { flipNumberingOrigin, numberingLayout } from './panelLayout.js';

export default function PanelFlipControl({ value, onChange }) {
  return <div className="panelFlipControl">
    <button className="secondary" type="button" onClick={() => onChange(flipNumberingOrigin(value))}>Flip panel 180°</button>
    <span role="status">#1: {numberingLayout(value).label}</span>
  </div>;
}
