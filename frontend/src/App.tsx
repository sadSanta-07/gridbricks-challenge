import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, AlertCircle, CalendarDays, Clock3, ExternalLink, RefreshCw, Wind, Zap, } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { format, parseISO } from 'date-fns';
import './App.css';

interface WindData {
  startTime: string;
  actual_generation: number;
  forecast_generation: number;
  error: number;
}

interface Metrics {
  mae: number;
  rmse: number;
  bias?: number;
  sample_count?: number;
}

interface ApiResponse {
  metrics: Metrics;
  chart_data: WindData[];
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const dateLabel = (value: string, pattern = 'dd MMM, HH:mm') => {
  try { return format(parseISO(value), pattern); } catch { return value; }
};
const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);

function StatusDot({ green = false }: { green?: boolean }) {
  return <span className={`status-dot${green ? ' status-dot--green' : ''}`} aria-hidden="true" />;
}

export default function App() {
  const [data, setData] = useState<WindData[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [range, setRange] = useState<'all' | '7d' | '24h'>('all');
  const [series, setSeries] = useState({ actual: true, forecast: true, error: false });

  const fetchData = useCallback(async () => {
    try {
      const response = await axios.get<ApiResponse>(
        `${API_URL}/api/wind-data`,
        { timeout: 45000 },
      );

      if (
        !Array.isArray(response.data.chart_data) ||
        !response.data.metrics
      ) {
        throw new Error('The API returned an unexpected data format.');
      }

      setData(
        [...response.data.chart_data].sort(
          (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
        ),
      );
      setMetrics(response.data.metrics);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.code === 'ECONNABORTED'
          ? 'The data request timed out. Try refreshing in a moment.'
          : err.response?.data?.detail ||
          'Could not connect to the GridBricks API. Check that the backend is running.'
        : err instanceof Error
          ? err.message
          : 'Something went wrong while loading wind data.';

      setError(String(message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const response = await axios.get<ApiResponse>(
          `${API_URL}/api/wind-data`,
          { timeout: 45000 }
        );

        if (cancelled) return;

        if (
          !Array.isArray(response.data.chart_data) ||
          !response.data.metrics
        ) {
          throw new Error('The API returned an unexpected data format.');
        }

        setData(
          [...response.data.chart_data].sort(
            (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)
          )
        );
        setMetrics(response.data.metrics);
        setUpdatedAt(new Date());
        setError(null);
      } catch (err) {
        if (cancelled) return;

        const message = axios.isAxiosError(err)
          ? err.code === 'ECONNABORTED'
            ? 'The data request timed out. Try refreshing in a moment.'
            : err.response?.data?.detail ||
            'Could not connect to the GridBricks API. Check that the backend is running.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong while loading wind data.';

        setError(String(message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleData = useMemo(() => {
    if (range === 'all' || data.length === 0) return data;
    const lastTime = Date.parse(data[data.length - 1].startTime);
    const cutoff = lastTime - (range === '7d' ? 7 : 1) * 24 * 60 * 60 * 1000;
    return data.filter((row) => Date.parse(row.startTime) >= cutoff);
  }, [data, range]);

  const maxGeneration = useMemo(() => {
    const values = visibleData.flatMap((row) => [row.actual_generation, row.forecast_generation]);
    return values.length ? Math.ceil(Math.max(...values) / 1000) * 1000 || 1000 : 1000;
  }, [visibleData]);
  const lastPoint = visibleData[visibleData.length - 1];
  const meanActual = visibleData.length ? visibleData.reduce((sum, row) => sum + row.actual_generation, 0) / visibleData.length : null;
  const meanForecast = visibleData.length ? visibleData.reduce((sum, row) => sum + row.forecast_generation, 0) / visibleData.length : null;

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Application navigation">
        <a className="brand-mark" href="#overview" aria-label="GridBricks overview"><Wind size={21} aria-hidden="true" /></a>
        <div className="rail-divider" />
        <a className="rail-link rail-link--active" href="#overview" aria-label="Overview"><Activity size={19} aria-hidden="true" /></a>
        <a className="rail-link" href="#analysis" aria-label="Forecast analysis"><Zap size={19} aria-hidden="true" /></a>
        <a className="rail-link" href="#methodology" aria-label="Methodology"><CalendarDays size={19} aria-hidden="true" /></a>
        <div className="rail-bottom"><span className="rail-live"><StatusDot green /></span></div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="topbar-brand"><span className="wordmark">GRIDBRICKS<span className="wordmark-period">.</span></span><span className="topbar-slash">/</span><span className="topbar-section">Wind intelligence</span></div>
          <div className="topbar-actions">
            <span className="environment"><StatusDot green /> National GB</span>
            <span className="topbar-separator" />
            <a className="source-link" href="https://bmrs.elexon.co.uk/api-documentation" target="_blank" rel="noreferrer">Elexon BMRS <ExternalLink size={13} aria-hidden="true" /></a>
            <button className="icon-button refresh-button" onClick={() => { setLoading(true); setError(null); void fetchData(); }} disabled={loading} aria-label="Refresh wind data"><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-index">01</span><span>Renewables / Wind generation</span><span className="eyebrow-line" /></div>
            <h1>Wind, <span>in focus.</span></h1>
            <p className="page-description">National wind output, forecast performance, and the signal behind day-ahead procurement.</p>
          </div>
          <div className="period-card"><span className="period-label"><CalendarDays size={13} aria-hidden="true" /> ANALYSIS WINDOW</span><strong>JAN <span>01</span> — JAN <span>31</span></strong><span className="period-year">2026 · Half-hourly intervals</span></div>
        </section>

        {error && <div className="error-banner" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Wind data unavailable</strong><span>{error}</span></div><button onClick={() => { setLoading(true); setError(null); void fetchData(); }}>Retry <RefreshCw size={13} aria-hidden="true" /></button></div>}

        <section className="metric-grid" aria-label="Forecast accuracy metrics">
          <article className="metric-card metric-card--primary">
            <div className="metric-top"><span className="metric-name">Mean absolute error</span><span className="metric-icon"><Activity size={16} aria-hidden="true" /></span></div>
            <div className="metric-value">{loading ? '—' : metrics ? number(metrics.mae) : '—'}<span>MW</span></div>
            <div className="metric-foot"><span className="metric-foot-label">MAE</span><span>Average absolute deviation</span></div><div className="metric-accent" />
          </article>
          <article className="metric-card">
            <div className="metric-top"><span className="metric-name">Root mean square error</span><span className="metric-icon"><Zap size={16} aria-hidden="true" /></span></div>
            <div className="metric-value">{loading ? '—' : metrics ? number(metrics.rmse) : '—'}<span>MW</span></div>
            <div className="metric-foot"><span className="metric-foot-label">RMSE</span><span>Penalises larger misses</span></div>
          </article>
          <article className="metric-card">
            <div className="metric-top"><span className="metric-name">Mean forecast bias</span><span className="metric-icon"><Activity size={16} aria-hidden="true" /></span></div>
            <div className="metric-value">{loading ? '—' : metrics?.bias != null ? `${metrics.bias > 0 ? '+' : ''}${number(metrics.bias)}` : '—'}<span>MW</span></div>
            <div className="metric-foot"><span className="metric-foot-label">BIAS</span><span>Actual minus forecast</span></div>
          </article>
          <article className="metric-card">
            <div className="metric-top"><span className="metric-name">Matched intervals</span><span className="metric-icon"><Clock3 size={16} aria-hidden="true" /></span></div>
            <div className="metric-value">{loading ? '—' : number(metrics?.sample_count ?? data.length)}<span className="metric-value-suffix">/ 1,488</span></div>
            <div className="metric-foot"><span className="metric-foot-label">COVERAGE</span><span>Matched 30-minute periods</span></div>
          </article>
        </section>

        <section className="chart-panel" id="analysis">
          <div className="panel-header">
            <div><div className="panel-kicker"><span className="panel-kicker-dot" /> OUTPUT / FORECAST COMPARISON</div><h2>Generation over time</h2><p className="panel-subtitle">Actual wind generation against the selected day-ahead forecast.</p></div>
            <div className="chart-controls" aria-label="Chart range">
              {(['all', '7d', '24h'] as const).map((option) => <button key={option} className={range === option ? 'range-button range-button--active' : 'range-button'} onClick={() => setRange(option)}>{option === 'all' ? '1M' : option === '7d' ? '7D' : '24H'}</button>)}
            </div>
          </div>
          <div className="legend-controls">
            <button className={`legend-toggle${series.actual ? ' is-on' : ''}`} onClick={() => setSeries((current) => ({ ...current, actual: !current.actual }))}><span className="legend-swatch legend-swatch--actual" /> Actual generation</button>
            <button className={`legend-toggle${series.forecast ? ' is-on' : ''}`} onClick={() => setSeries((current) => ({ ...current, forecast: !current.forecast }))}><span className="legend-swatch legend-swatch--forecast" /> Forecast generation</button>
            <button className={`legend-toggle${series.error ? ' is-on' : ''}`} onClick={() => setSeries((current) => ({ ...current, error: !current.error }))}><span className="legend-swatch legend-swatch--error" /> Forecast error</button>
            <span className="chart-units">UNIT / MW</span>
          </div>
          <div className="chart-wrap">
            {loading && data.length === 0 ? <div className="chart-state"><span className="loading-orbit" /><span>Connecting to Elexon data stream…</span></div> : !loading && visibleData.length === 0 ? <div className="chart-state"><Wind size={25} aria-hidden="true" /><strong>No matched intervals yet</strong><span>Check the backend response and try refreshing.</span></div> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#262b2a" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="startTime" tickFormatter={(value: string) => dateLabel(value, range === '24h' ? 'HH:mm' : 'dd MMM')} minTickGap={32} tick={{ fill: '#777f7b', fontSize: 11, fontFamily: 'monospace' }} axisLine={{ stroke: '#303633' }} tickLine={false} />
                  <YAxis domain={[0, maxGeneration]} width={57} tickFormatter={(value: number) => `${(value / 1000).toFixed(value >= 1000 ? 1 : 0)}${value >= 1000 ? 'k' : ''}`} tick={{ fill: '#777f7b', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <Tooltip labelFormatter={(value) => dateLabel(String(value), 'dd MMM yyyy · HH:mm')} formatter={(value, name) => [`${number(Number(value))} MW`, String(name)]} contentStyle={{ background: '#111512', border: '1px solid #303833', borderRadius: 8, color: '#f1f4f0', fontSize: 12 }} labelStyle={{ color: '#a4aca6', marginBottom: 6 }} itemStyle={{ padding: '2px 0' }} />
                  {series.actual && <Line type="monotone" dataKey="actual_generation" name="Actual generation" stroke="#c2f879" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} />}
                  {series.forecast && <Line type="monotone" dataKey="forecast_generation" name="Forecast generation" stroke="#7f9dff" strokeWidth={1.8} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} />}
                  {series.error && <Line type="monotone" dataKey="error" name="Forecast error" stroke="#e99c66" strokeWidth={1.2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls={false} />}
                  <Legend content={() => null} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <footer className="chart-footer"><span><StatusDot green /> {loading ? 'FETCHING DATA' : error ? 'CONNECTION ISSUE' : 'DATA LOADED'}</span><span>{visibleData.length.toLocaleString('en-GB')} INTERVALS DISPLAYED</span><span>{updatedAt ? `UPDATED ${format(updatedAt, 'HH:mm:ss')}` : 'AWAITING FIRST RESPONSE'}</span></footer>
        </section>

        <section className="insight-grid">
          <article className="insight-card insight-card--wide">
            <div className="insight-heading"><span className="insight-number">A</span><div><span className="panel-kicker">LATEST MATCHED INTERVAL</span><h3>Where the forecast stands</h3></div></div>
            {lastPoint ? <div className="latest-data"><div><span>DELIVERY TIME</span><strong>{dateLabel(lastPoint.startTime, 'dd MMM · HH:mm')}</strong></div><div><span>ACTUAL</span><strong>{number(lastPoint.actual_generation)} <small>MW</small></strong></div><div><span>FORECAST</span><strong>{number(lastPoint.forecast_generation)} <small>MW</small></strong></div><div><span>ERROR</span><strong className={lastPoint.error > 0 ? 'positive-error' : lastPoint.error < 0 ? 'negative-error' : ''}>{lastPoint.error > 0 ? '+' : ''}{number(lastPoint.error)} <small>MW</small></strong></div></div> : <p className="insight-empty">Latest interval will appear when matched data is available.</p>}
          </article>
          <article className="insight-card">
            <div className="insight-heading"><span className="insight-number">B</span><div><span className="panel-kicker">PERIOD AVERAGE</span><h3>Output baseline</h3></div></div>
            <div className="baseline-rows"><div><span><i className="baseline-dot baseline-dot--actual" /> Actual average</span><strong>{meanActual == null ? '—' : `${number(meanActual)} MW`}</strong></div><div><span><i className="baseline-dot baseline-dot--forecast" /> Forecast average</span><strong>{meanForecast == null ? '—' : `${number(meanForecast)} MW`}</strong></div></div>
            <p className="small-note">Calculated from the intervals currently in view.</p>
          </article>
        </section>

        <section className="methodology" id="methodology">
          <div className="methodology-left"><span className="panel-kicker">METHODOLOGY / 01</span><h2>Clean comparisons.<br /><span>Clear assumptions.</span></h2></div>
          <div className="methodology-right"><p>Actual generation is sourced from Elexon BMRS FUELHH; wind forecasts come from WINDFOR. Only matched half-hourly delivery intervals are compared.</p><div className="method-tags"><span>FUELHH / ACTUALS</span><span>WINDFOR / FORECASTS</span><span>30-MIN RESOLUTION</span></div><p className="methodology-disclaimer">Forecast accuracy is not a direct measure of procurement cost. The forecast publication cutoff should match the trading team's actual day-ahead decision deadline.</p></div>
        </section>

        <footer className="app-footer"><div className="footer-brand"><Wind size={16} aria-hidden="true" /><span>GRIDBRICKS<span className="wordmark-period">.</span></span></div><span>WIND INTELLIGENCE <span className="footer-divider">/</span> JANUARY 2026</span><a href="https://bmrs.elexon.co.uk/api-documentation" target="_blank" rel="noreferrer">DATA BY ELEXON <ExternalLink size={12} aria-hidden="true" /></a></footer>
      </main>
    </div>
  );
}
