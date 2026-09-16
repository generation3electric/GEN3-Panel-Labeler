export const NUMBERING_ORIGINS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export function normalizeNumberingOrigin(value) {
  return NUMBERING_ORIGINS.some((item) => item.value === value) ? value : 'top-left';
}

export function numberingLayout(value) {
  const origin = normalizeNumberingOrigin(value);
  return { origin, bottomUp: origin.startsWith('bottom-'), oddLeft: origin.endsWith('-left'),
    label: NUMBERING_ORIGINS.find((item) => item.value === origin).label };
}

export function circuitSide(circuit, origin) {
  return (circuit % 2 === 1) === numberingLayout(origin).oddLeft ? 'left' : 'right';
}

// A circuit retains its identity and description. Only its displayed position changes.
export function panelDisplayPairs(spaces, origin) {
  const { bottomUp, oddLeft } = numberingLayout(origin);
  const pairCount = Math.ceil(spaces / 2);
  return Array.from({ length: pairCount }, (_, row) => {
    const pair = bottomUp ? pairCount - row - 1 : row;
    const odd = pair * 2 + 1;
    const even = odd + 1 <= spaces ? odd + 1 : null;
    return { left: oddLeft ? odd : even, right: oddLeft ? even : odd };
  });
}

export function breakerPlacement(circuit, spaces, origin, poles = 1) {
  const { bottomUp } = numberingLayout(origin);
  const pairCount = Math.ceil(spaces / 2);
  const pair = Math.floor((circuit - 1) / 2);
  const row = bottomUp ? pairCount - pair - 1 : pair;
  const span = poles === 2 && circuit + 2 <= spaces ? 2 : 1;
  return { side: circuitSide(circuit, origin), row: bottomUp ? row - span + 1 : row, span };
}

export function adjacentCircuit(circuit, screenDirection, origin) {
  return circuit + screenDirection * (numberingLayout(origin).bottomUp ? -2 : 2);
}
