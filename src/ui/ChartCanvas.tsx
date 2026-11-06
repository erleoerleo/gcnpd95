import { useEffect, useRef, useState } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

Chart.register(ScatterController, LineController, BarController, PointElement, LineElement, BarElement, LinearScale, CategoryScale, Tooltip, Legend);

// Validated categorical palette (dataviz reference instance), light and dark steps.
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const POINT_STYLES = ['circle', 'triangle', 'rect', 'rectRot', 'crossRot', 'star', 'rectRounded', 'cross'] as const;

export interface Theme {
  dark: boolean;
  ink: string;
  muted: string;
  line: string;
  surface: string;
  series: string[];
  guide: string;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const dark = cs.colorScheme.includes('dark') || v('color-scheme') === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  return {
    dark,
    ink: v('--ink'),
    muted: v('--muted'),
    line: v('--line-soft'),
    surface: v('--surface'),
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    guide: v('--muted'),
  };
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(readTheme());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}

export function ChartCanvas(props: { config: ChartConfiguration; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current, props.config);
    return () => chart.destroy();
  }, [props.config]);
  return (
    <div className={props.className ?? 'chart-canvas'}>
      <canvas ref={ref} role="img" aria-label={props.label} />
    </div>
  );
}

export function baseOptions(t: Theme) {
  Chart.defaults.font.family = "'Archivo Variable', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = t.muted;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: t.ink, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } },
      tooltip: {
        backgroundColor: t.dark ? '#e2e9e6' : '#1b2b30',
        titleColor: t.dark ? '#121c1f' : '#f7f8f5',
        bodyColor: t.dark ? '#121c1f' : '#f7f8f5',
        padding: 10,
        displayColors: true,
        boxPadding: 4,
      },
    },
  };
}

export function axis(t: Theme, title: string, extra: Record<string, unknown> = {}) {
  return {
    title: { display: !!title, text: title, color: t.ink, font: { weight: 600 as const } },
    grid: { color: t.line, drawTicks: false },
    border: { color: t.line },
    ticks: { color: t.muted, padding: 6 },
    ...extra,
  };
}
