// Reconstructs a chromatogram-like trace from reported peak values. GC-NPD-95 files carry one value
// per compound (area, height or concentration), not the detector signal or retention times, so peaks
// are drawn as Gaussians at approximate positions.

/**
 * Approximate Kovats retention indices on a non-polar column for compounds whose position is well
 * established. n-Alkanes (nCxx) are handled by rule (100 x carbon number).
 */
const RETENTION_INDEX: Record<string, number> = {
  C1: 100, C2: 200, C3: 300, iC4: 367, nC4: 400, iC5: 475, nC5: 500,
  '22DMC4': 537, '23DMC4': 567, '2MC5': 570, '3MC5': 584, nC6: 600, MCyC5: 627, Benzene: 654,
  CyC6: 663, '2MC6': 668, '3MC6': 676, c13DMCyC5: 682, t13DMCyC5: 686, t12DMCyC5: 688,
  nC7: 700, MCyC6: 721, Toluene: 763, nC8: 800, mpXylene: 866, oXylene: 887, nC9: 900,
  Pristane: 1707, Phytane: 1811,
};

export function retentionIndex(name: string): number | null {
  if (name in RETENTION_INDEX) return RETENTION_INDEX[name];
  const m = name.match(/^n?C(\d{1,2})$/);
  return m ? Number(m[1]) * 100 : null;
}

export interface PlacedPeak {
  name: string;
  x: number;
}

/**
 * Positions for peaks given in reported (elution) order. With at least two compounds of known
 * retention index the axis is a retention index and the others are spaced evenly between their known
 * neighbours; otherwise peaks are spaced evenly in reported order.
 */
export function placePeaks(names: string[]): { peaks: PlacedPeak[]; axis: 'retention' | 'order' } {
  const known = names.map(retentionIndex);
  const anchors = known.map((v, i) => [i, v] as const).filter(([, v]) => v !== null) as [number, number][];
  if (anchors.length < 2) return { peaks: names.map((name, i) => ({ name, x: (i + 1) * 100 })), axis: 'order' };

  // unknown peaks: interpolate between the surrounding anchors in reported order
  const x: number[] = names.map(() => NaN);
  for (const [i, v] of anchors) x[i] = v;
  const anchorsByIndex = [...anchors].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < names.length; i++) {
    if (!Number.isNaN(x[i])) continue;
    const prev = [...anchorsByIndex].reverse().find(([j]) => j < i);
    const next = anchorsByIndex.find(([j]) => j > i);
    if (prev && next && next[1] > prev[1]) {
      x[i] = prev[1] + ((next[1] - prev[1]) * (i - prev[0])) / (next[0] - prev[0]);
    } else if (prev) x[i] = prev[1] + 25 * (i - prev[0]);
    else if (next) x[i] = next[1] - 25 * (next[0] - i);
  }
  return { peaks: names.map((name, i) => ({ name, x: x[i] })), axis: 'retention' };
}

/** Peak width used for all peaks of one chromatogram: narrow enough to separate close neighbours. */
export function peakSigma(xs: number[]): number {
  const s = [...new Set(xs)].sort((a, b) => a - b);
  const gaps = s.slice(1).map((v, i) => v - s[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return 5;
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.min(Math.max(gaps[0] * 0.28, median * 0.012, 1), median * 0.07);
}

/** Sum of Gaussian peaks, sampled densely around each peak and sparsely in between. */
export function trace(peaks: { x: number; h: number }[], sigma: number, range: [number, number]): { x: number; y: number }[] {
  const xs = new Set<number>([range[0], range[1]]);
  for (const p of peaks) for (let k = -4; k <= 4; k += 0.4) xs.add(p.x + k * sigma);
  for (let v = range[0]; v <= range[1]; v += (range[1] - range[0]) / 200) xs.add(v);
  return [...xs]
    .filter((v) => v >= range[0] && v <= range[1])
    .sort((a, b) => a - b)
    .map((v) => {
      let y = 0;
      for (const p of peaks) {
        const d = (v - p.x) / sigma;
        if (d > -6 && d < 6) y += p.h * Math.exp(-0.5 * d * d);
      }
      return { x: v, y };
    });
}
