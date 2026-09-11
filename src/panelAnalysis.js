const KNOWN_BREAKER_TYPES = new Set(['standard', 'afci', 'gfci', 'dual', 'surge']);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function confidenceLabel(circuit) {
  const score = Number(circuit?.confidence);
  const poles = positiveInteger(circuit?.poles);
  const missingRequiredReading = !positiveInteger(circuit?.amps)
    || (poles !== 1 && poles !== 2)
    || !String(circuit?.description || '').trim()
    || !KNOWN_BREAKER_TYPES.has(circuit?.breakerType);
  return circuit?.needsReview || !Number.isFinite(score) || score < 0.85 || missingRequiredReading
    ? 'Review'
    : 'High';
}

function breakerKind(circuit) {
  const poles = positiveInteger(circuit?.poles) === 2 ? 2 : 1;
  const family = KNOWN_BREAKER_TYPES.has(circuit?.breakerType) ? circuit.breakerType : 'unknown';
  return `${poles}p_${family}`;
}

function rowCount(panel, analysis) {
  const circuits = Array.isArray(analysis?.circuits) ? analysis.circuits : [];
  const largestDetectedPosition = circuits.reduce((largest, circuit) => {
    const position = positiveInteger(circuit?.circuit);
    if (!position) return largest;
    return Math.max(largest, position + (positiveInteger(circuit?.poles) === 2 ? 2 : 0));
  }, 0);
  const requested = Math.max(
    positiveInteger(panel?.spaces) || 0,
    positiveInteger(analysis?.panel?.spaceCount) || 0,
    largestDetectedPosition,
  );
  // Keep a usable empty layout when neither the technician nor AI could determine panel size.
  const count = requested || 30;
  return Math.min(84, Math.max(2, count + (count % 2)));
}

/**
 * Convert the server's structured AI result into the row model used by the
 * physical odd/even verification screen. Missing readings stay missing; this
 * function never fills the directory with example breaker data.
 */
export function buildRowsFromAnalysis(panel, analysis) {
  const count = rowCount(panel, analysis);
  const rows = Array.from({ length: count }, (_, index) => ({
    circuit: index + 1,
    amps: null,
    breakerKind: '1p_unknown',
    description: '',
    confidence: 'Review',
    confidenceScore: null,
    notes: '',
    aiDetected: false,
    continuationOf: null,
  }));
  const warnings = [];
  const circuits = Array.isArray(analysis?.circuits)
    ? [...analysis.circuits].sort((a, b) => Number(a?.circuit || 0) - Number(b?.circuit || 0))
    : [];

  for (const circuit of circuits) {
    const position = positiveInteger(circuit?.circuit);
    if (!position || position > count) {
      warnings.push(`AI returned an invalid circuit position (${circuit?.circuit ?? 'missing'}).`);
      continue;
    }

    const target = rows[position - 1];
    if (target.continuationOf) {
      warnings.push(`Circuit ${position} conflicts with the 2-pole breaker beginning at circuit ${target.continuationOf}.`);
      const start = rows[target.continuationOf - 1];
      if (start) start.confidence = 'Review';
      continue;
    }

    const poles = positiveInteger(circuit?.poles) === 2 ? 2 : 1;
    const score = Number(circuit?.confidence);
    const expectedSide = position % 2 === 1 ? 'left' : 'right';
    if (circuit?.side && circuit.side !== expectedSide) {
      warnings.push(`Circuit ${position} was identified on the ${circuit.side} side; verify its physical position.`);
    }
    Object.assign(target, {
      amps: positiveInteger(circuit?.amps),
      breakerKind: breakerKind(circuit),
      description: String(circuit?.description || '').trim().slice(0, 280),
      confidence: confidenceLabel(circuit),
      confidenceScore: Number.isFinite(score) ? score : null,
      notes: String(circuit?.notes || '').trim(),
      aiDetected: true,
    });

    if (poles === 2) {
      const continuation = rows[position + 1]; // Same panel side: circuit N continues at N + 2.
      if (!continuation) {
        target.confidence = 'Review';
        warnings.push(`The 2-pole breaker at circuit ${position} extends beyond the reported panel size.`);
        continue;
      }
      Object.assign(continuation, {
        amps: target.amps,
        breakerKind: target.breakerKind,
        description: target.description,
        confidence: target.confidence,
        confidenceScore: target.confidenceScore,
        notes: target.notes,
        aiDetected: true,
        continuationOf: position,
      });
    }
  }

  return { rows, warnings };
}

export function getAIAnalysis(savedRecord) {
  return savedRecord?.aiAnalysis || savedRecord?.ai?.analysis || savedRecord?.receipt?.aiAnalysis || null;
}
