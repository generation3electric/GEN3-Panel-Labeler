import React, { useMemo, useState } from 'react';
import './ProcessingReview.css';

const commonCircuits = [
  'Kitchen Receptacles','Kitchen Lighting','Dining Room','Living Room','Bedroom 1','Bedroom 2','Bedroom 3',
  'Bathroom','Bathroom GFCI','Laundry','Washer','Dryer','Dishwasher','Garbage Disposal','Microwave','Range',
  'Refrigerator','Basement','Garage','Exterior / GFCI','Smoke / CO','HVAC','Air Handler','Condenser','Heat Pump',
  'Water Heater','Boiler','Sump Pump','EV Charger','Pool','Spa','Subpanel','Surge Protector','Spare','Unknown'
];

const breakerTypes = ['Standard', 'AFCI', 'GFCI', 'Dual Function', 'Surge Protector'];

function buildRows(spaces) {
  const count = Math.max(12, Math.min(Number(spaces) || 20, 42));
  const result = Array.from({ length: count }, (_, index) => ({
    circuit: index + 1,
    amps: [15,20,20,20,15,20,15,15,20,20,15,20][index % 12],
    poles: 1,
    type: index === 4 ? 'AFCI' : index === 9 ? 'GFCI' : 'Standard',
    description: index % 3 === 0 ? '' : commonCircuits[index % 18],
    confidence: index % 7 === 0 ? 'Review' : 'High',
    continuationOf: null,
  }));

  // Demo a few multi-space devices the same way a physical panel presents them.
  const makeTwoPole = (circuit, amps, description) => {
    const first = result.find((r) => r.circuit === circuit);
    const second = result.find((r) => r.circuit === circuit + 2);
    if (!first || !second || circuit % 2 !== (circuit + 2) % 2) return;
    first.poles = 2;
    first.amps = amps;
    first.description = description;
    first.type = 'Standard';
    second.continuationOf = circuit;
    second.amps = amps;
    second.description = description;
    second.type = 'Standard';
  };

  if (count >= 16) makeTwoPole(count % 2 === 0 ? count - 5 : count - 4, 30, 'Dryer');
  if (count >= 20) makeTwoPole(count % 2 === 0 ? count - 6 : count - 5, 50, 'Range');
  return result;
}

function DeviceBadge({ type }) {
  if (type === 'Standard') return null;
  return <span className={`deviceBadge ${type.toLowerCase().replaceAll(' ', '-')}`}>{type}</span>;
}

export default function ProcessingReview({ job, panel, photoUrls, savedRecord, onStartOver }) {
  const [phase, setPhase] = useState('ready');
  const initialRows = useMemo(() => buildRows(panel.spaces), [panel.spaces]);
  const [rows, setRows] = useState(initialRows);

  function runPreview() {
    setPhase('processing');
    window.setTimeout(() => setPhase('review'), 900);
  }

  function updateCircuit(circuit, key, value) {
    setRows((current) => current.map((row) => {
      if (row.circuit === circuit) return { ...row, [key]: value };
      if (row.continuationOf === circuit) return { ...row, [key]: value };
      return row;
    }));
  }

  function setPoles(circuit, poles) {
    setRows((current) => {
      const target = current.find((r) => r.circuit === circuit);
      if (!target || target.continuationOf) return current;
      const sameSideNext = current.find((r) => r.circuit === circuit + 2);
      return current.map((row) => {
        if (row.circuit === circuit) return { ...row, poles };
        if (poles === 2 && sameSideNext && row.circuit === sameSideNext.circuit) {
          return { ...row, continuationOf: circuit, amps: target.amps, description: target.description, type: target.type };
        }
        if (poles === 1 && row.continuationOf === circuit) {
          return { ...row, continuationOf: null, description: '', poles: 1, confidence: 'Review' };
        }
        return row;
      });
    });
  }

  const byCircuit = Object.fromEntries(rows.map((row) => [row.circuit, row]));
  const physicalRows = Math.ceil(rows.length / 2);

  function renderBreaker(circuit, side) {
    const row = byCircuit[circuit];
    if (!row) return <div className={`panelSlot empty ${side}`} />;
    if (row.continuationOf) {
      return (
        <div className={`panelSlot continuation ${side}`}>
          <span className="slotNumber">{row.circuit}</span>
          <div className="continuationFill"><strong>{row.amps}A</strong><small>2-pole continuation</small></div>
        </div>
      );
    }

    return (
      <div className={`panelSlot ${side} ${row.confidence === 'Review' ? 'needsReview' : ''} ${row.poles === 2 ? 'twoPoleStart' : ''}`}>
        <span className="slotNumber">{row.circuit}</span>
        <div className="breakerAmpBlock">
          <select value={row.amps} onChange={(e) => updateCircuit(row.circuit, 'amps', e.target.value)} aria-label={`Circuit ${row.circuit} amps`}>
            {[15,20,25,30,40,50,60,70,80,90,100,125,150,175,200].map((amp) => <option key={amp} value={amp}>{amp}A</option>)}
          </select>
          <select value={row.poles} onChange={(e) => setPoles(row.circuit, Number(e.target.value))} aria-label={`Circuit ${row.circuit} poles`}>
            <option value={1}>1P</option><option value={2}>2P</option>
          </select>
        </div>
        <div className="breakerEdit">
          <input list="common-circuit-names" placeholder="Search or type circuit…" value={row.description} onChange={(e) => updateCircuit(row.circuit, 'description', e.target.value)} />
          <select value={row.type} onChange={(e) => updateCircuit(row.circuit, 'type', e.target.value)}>
            {breakerTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
          <DeviceBadge type={row.type} />
        </div>
        {row.confidence === 'Review' && <span className="reviewBadge">Check</span>}
      </div>
    );
  }

  if (phase === 'ready' || phase === 'processing') {
    return (
      <main className="content processPage">
        <p className="eyebrow">Panel processing</p>
        <h1>Turn the field record into a finished directory.</h1>
        <p className="lead">The review screen now follows the physical panel: odd circuits on the left, even circuits on the right, breaker ratings toward the center, and multi-pole devices occupying multiple vertical spaces.</p>
        <div className="processSteps">
          <div><span>1</span><strong>Read breaker geometry</strong><small>Position, amperage, poles and special breaker type</small></div>
          <div><span>2</span><strong>Read existing labels</strong><small>Use them when available; blank is acceptable</small></div>
          <div><span>3</span><strong>Human verification</strong><small>Fast search/drop-down plus free typing</small></div>
          <div><span>4</span><strong>Generate final directory</strong><small>Permanent record ready for the next load-calculation step</small></div>
        </div>
        {photoUrls?.breakerField && <img className="processHeroPhoto" src={photoUrls.breakerField} alt="Breaker field" />}
        <button className="primary large" onClick={runPreview} disabled={phase === 'processing'}>{phase === 'processing' ? 'Processing photos…' : 'Process Panel Photos'}</button>
        {savedRecord?.folderUrl && <a className="sharePointLink" href={savedRecord.folderUrl} target="_blank" rel="noreferrer">Open source photos in SharePoint</a>}
      </main>
    );
  }

  if (phase === 'final') {
    const left = rows.filter((r) => r.circuit % 2 === 1 && !r.continuationOf);
    const right = rows.filter((r) => r.circuit % 2 === 0 && !r.continuationOf);
    return (
      <main className="content finalDirectoryPage">
        <section className="directorySheet">
          <div className="directoryBrand"><strong>GEN3</strong><span>Electric & HVAC</span></div>
          <h2>Electrical Panel Directory</h2>
          <div className="directoryMeta">
            <div><span>Customer</span><strong>{job.customer}</strong></div><div><span>Job</span><strong>#{job.id}</strong></div>
            <div><span>Address</span><strong>{job.address}</strong></div><div><span>Panel</span><strong>{panel.name}</strong></div>
            <div><span>Manufacturer</span><strong>{panel.manufacturer}</strong></div><div><span>Main</span><strong>{panel.mainAmps ? `${panel.mainAmps} A` : 'Verify'}</strong></div>
          </div>
          <div className="directoryColumns">
            {[left, right].map((column, columnIndex) => <div className="directoryColumn" key={columnIndex}>{column.map((row) => (
              <div className="directoryLine" key={row.circuit}><b>{row.circuit}</b><span>{row.description || 'Unlabeled'}</span><em>{row.amps}A{row.poles === 2 ? ' 2P' : ''}{row.type !== 'Standard' ? ` · ${row.type}` : ''}</em></div>
            ))}</div>)}
          </div>
          <div className="directoryFooter">Verified panel directory · GEN3 Electric & HVAC · {new Date().toLocaleDateString()}</div>
        </section>
        <div className="finalActions noPrint"><button className="secondary" onClick={() => setPhase('review')}>Back to Review</button><button className="primary" onClick={() => window.print()}>Print / Save PDF</button></div>
        <div className="nextProcessCard noPrint"><span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for the load-calculation workflow.</p><button disabled>Coming next</button></div>
        <button className="secondary noPrint" onClick={onStartOver}>Start Another Panel</button>
      </main>
    );
  }

  return (
    <main className="content processPage panelReviewPage">
      <datalist id="common-circuit-names">{commonCircuits.map((name) => <option value={name} key={name} />)}</datalist>
      <p className="eyebrow">AI review preview</p>
      <h1>Verify the panel the way it is physically laid out.</h1>
      <div className="reviewNotice"><strong>{rows.filter((r) => r.confidence === 'Review' && !r.continuationOf).length} items need a closer look.</strong><span>Blank circuit names are expected. Search common names or type anything manually.</span></div>
      <div className="panelLegend"><span><i className="legendStandard" />Standard</span><span><i className="legendAfci" />AFCI / GFCI</span><span><i className="legendSurge" />Surge</span><span><i className="legendReview" />Needs review</span></div>
      <div className="physicalPanel">
        <div className="panelColumnHeader leftHeader">ODD / LEFT</div><div className="centerHeader">BREAKER AMPS</div><div className="panelColumnHeader rightHeader">EVEN / RIGHT</div>
        {Array.from({ length: physicalRows }, (_, index) => {
          const odd = index * 2 + 1;
          const even = index * 2 + 2;
          return <React.Fragment key={index}>{renderBreaker(odd, 'left')}{renderBreaker(even, 'right')}</React.Fragment>;
        })}
      </div>
      <div className="reviewActions"><button className="secondary" onClick={() => setPhase('ready')}>Back</button><button className="primary" onClick={() => setPhase('final')}>Generate Final Directory</button></div>
      <div className="nextProcessCard"><span>Planned next step</span><strong>Load Calculation</strong><p>The verified breaker map will become the electrical inventory for the load calculation, reducing duplicate entry.</p></div>
    </main>
  );
}
