import { useState } from "react";

// ── Terrain Design System v2 ───────────────────────────────────────

const T = {
  bg: "#F6F3EE",
  surface: "#FFFFFF",
  surfaceHover: "#FAF8F4",
  border: "#E5DFD4",
  borderLight: "#EDE8E0",
  text: "#1A1610",
  textSecondary: "#5C5548",
  textTertiary: "#8C8374",
  textOnDark: "#FAF7F2",
  strava: "#FC4C02",
  accent: "#B85A28",
  awards: {
    season_first:       { dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
    year_best:          { dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
    top_decile:         { dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
    recent_best:        { dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
    consistency:        { dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
    comeback:           { dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
    monthly_best:       { dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
    improvement_streak: { dot: "#3D7A4A", bg: "#E4F0E4", text: "#204E28", border: "#B8D4B0" },
    ytd_best_time:      { dot: "#9C6E18", bg: "#F8ECD0", text: "#5E4010", border: "#E0CCA0" },
    ytd_best_power:     { dot: "#B85030", bg: "#F6DED4", text: "#7A2E18", border: "#E4B8A4" },
    milestone:          { dot: "#8C7A30", bg: "#F4EEDA", text: "#5C5018", border: "#DCD4A8" },
    top_quartile:       { dot: "#5B6CA0", bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC" },
    beat_median:        { dot: "#7A5C8A", bg: "#ECE4F0", text: "#4A3060", border: "#CCC0D8" },
    closing_in:         { dot: "#A04880", bg: "#F2E0EC", text: "#6A2858", border: "#D8B8D0" },
    anniversary:        { dot: "#6B5CA0", bg: "#E8E4F4", text: "#3E3070", border: "#C4BCD8" },
  },
};

// ── SVG Badge Icons ────────────────────────────────────────────────
// Inline SVGs that match the Gemini geometric style, implementable in Canvas

function BadgeIcon({ type, size = 16, color }) {
  const c = color || T.awards[type]?.dot || "#6B6260";
  const s = { width: size, height: size, flexShrink: 0 };
  const sw = size > 20 ? 2 : 1.5;

  const icons = {
    season_first: ( // Seedling
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22V12"/>
        <path d="M8 8c0-3 4-6 4-6s4 3 4 6c0 2.5-1.8 4-4 4S8 10.5 8 8z"/>
        <path d="M5 14c2-2 5-1 7 0"/>
        <path d="M19 14c-2-2-5-1-7 0"/>
      </svg>
    ),
    year_best: ( // Five-pointed star
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinejoin="round">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
      </svg>
    ),
    top_decile: ( // Double chevron up
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6,15 12,9 18,15"/>
        <polyline points="6,20 12,14 18,20"/>
      </svg>
    ),
    recent_best: ( // Upward trend arrow
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22,7 13.5,15.5 8.5,10.5 2,17"/>
        <polyline points="16,7 22,7 22,13"/>
      </svg>
    ),
    consistency: ( // Three bars
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round">
        <line x1="4" y1="8" x2="20" y2="8"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="16" x2="20" y2="16"/>
      </svg>
    ),
    comeback: ( // Return arrow
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 1 3 6.7"/>
        <polyline points="3 20 3 13 10 13"/>
      </svg>
    ),
    monthly_best: ( // Calendar star
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <polygon points="12,12 13.5,15 17,15.5 14.5,17.5 15,21 12,19.2 9,21 9.5,17.5 7,15.5 10.5,15" strokeWidth={sw * 0.8}/>
      </svg>
    ),
    improvement_streak: ( // Ascending steps
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4,18 4,14 9,14 9,10 14,10 14,6 20,6"/>
        <polyline points="17,3 20,6 17,9"/>
      </svg>
    ),
    ytd_best_time: ( // Clock with star
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <polyline points="12,7 12,12 16,14"/>
      </svg>
    ),
    ytd_best_power: ( // Lightning bolt
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
      </svg>
    ),
    milestone: ( // Flag on peak
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 22L12 6l8 16"/>
        <line x1="12" y1="6" x2="12" y2="2"/>
        <path d="M12 2l5 2.5L12 7"/>
      </svg>
    ),
    top_quartile: ( // Single chevron up
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6,16 12,8 18,16"/>
      </svg>
    ),
    beat_median: ( // Diamond
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinejoin="round">
        <polygon points="12,3 21,12 12,21 3,12"/>
      </svg>
    ),
    closing_in: ( // Target/bullseye
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw}>
        <circle cx="12" cy="12" r="9"/>
        <circle cx="12" cy="12" r="5"/>
        <circle cx="12" cy="12" r="1.5"/>
      </svg>
    ),
    anniversary: ( // Circular arrow
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-6.7-8.7"/>
        <polyline points="21,3 21,9 15,9"/>
      </svg>
    ),
  };

  return icons[type] || <span className="inline-block rounded-full" style={{ width: size, height: size, background: c }} />;
}

// ── Award Pill with Icon ───────────────────────────────────────────

function AwardPill({ label, type, size = "md", showIcon = true }) {
  const a = T.awards[type] || T.awards.season_first;
  const isLg = size === "lg";
  const cls = isLg ? "text-sm px-3 py-1.5" : "text-xs px-2.5 py-1";
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${cls}`}
      style={{ background: a.bg, color: a.text, border: `1px solid ${a.border}`,
        fontFamily: "'DM Sans', sans-serif" }}>
      {showIcon ? <BadgeIcon type={type} size={isLg ? 16 : 12} /> : (
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.dot }} />
      )}
      {label}
    </span>
  );
}

// ── Wordmark ───────────────────────────────────────────────────────

function Wordmark({ variant, fontSize = 48 }) {
  if (variant === "dot") {
    return (
      <span style={{ fontFamily: "'Instrument Serif', serif", fontSize, fontWeight: 400, lineHeight: 1.1 }}>
        <span style={{ color: T.text }}>aeyu</span>
        <span style={{ color: T.accent }}>.</span>
        <span style={{ color: T.text }}>io</span>
      </span>
    );
  }
  if (variant === "io") {
    return (
      <span style={{ fontFamily: "'Instrument Serif', serif", fontSize, fontWeight: 400, lineHeight: 1.1 }}>
        <span style={{ color: T.text }}>aeyu</span>
        <span style={{ color: T.accent }}>.io</span>
      </span>
    );
  }
  return (
    <span style={{ fontFamily: "'Instrument Serif', serif", fontSize, fontWeight: 400, lineHeight: 1.1, color: T.text }}>
      aeyu.io
    </span>
  );
}

// ── Share Card ─────────────────────────────────────────────────────

function ShareCard() {
  const awards = [
    { type: "season_first", label: "3× Season First" },
    { type: "year_best", label: "Year Best" },
    { type: "top_decile", label: "Top 10%" },
  ];
  const segs = [
    { name: "Old Mill Road", time: "4:32", delta: "12s faster", award: "year_best" },
    { name: "River Valley Climb", time: "8:14", delta: null, award: "season_first" },
    { name: "Hilltop Sprint", time: "1:58", delta: "3s faster", award: "top_decile" },
  ];
  return (
    <div className="rounded-xl overflow-hidden relative max-w-md"
      style={{ background: T.bg, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: `1px solid ${T.border}` }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.03 }} xmlns="http://www.w3.org/2000/svg">
        <defs><pattern id="topo2" width="100" height="100" patternUnits="userSpaceOnUse">
          <circle cx="50" cy="50" r="15" fill="none" stroke="#8B7355" strokeWidth="0.6"/>
          <circle cx="50" cy="50" r="30" fill="none" stroke="#8B7355" strokeWidth="0.6"/>
          <circle cx="50" cy="50" r="45" fill="none" stroke="#8B7355" strokeWidth="0.6"/>
        </pattern></defs>
        <rect width="100%" height="100%" fill="url(#topo2)"/>
      </svg>

      <div className="relative z-10 p-6">
        <div className="flex justify-between items-baseline mb-3">
          <Wordmark variant="io" fontSize={18} />
          <span className="text-sm" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>
            Participation Awards
          </span>
        </div>
        <div className="h-px mb-5" style={{ background: T.border }} />

        <h3 className="text-2xl font-normal mb-2 leading-snug"
          style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>
          Sunday Morning Climb
        </h3>
        <p className="text-sm mb-4 tracking-wide"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.textSecondary }}>
          Mar 8, 2026 · 42.3 km · 1:48:22 · 620m
        </p>

        {/* Awards with icons */}
        <div className="flex flex-wrap gap-2 mb-5">
          {awards.map(a => <AwardPill key={a.type} type={a.type} label={a.label} size="lg" showIcon={true} />)}
        </div>

        {/* Segments with icons */}
        <div className="space-y-3">
          {segs.map((s, i) => {
            const a = T.awards[s.award];
            return (
              <div key={i} className="flex items-center gap-3">
                <BadgeIcon type={s.award} size={20} />
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ fontFamily: "'DM Sans', sans-serif", color: T.text }}>
                    {s.name}
                  </div>
                  <div className="text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.textTertiary }}>
                    {s.time}
                    {s.delta && <span style={{ color: T.awards.season_first.dot, marginLeft: 8 }}>{s.delta}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-sm italic mt-5 pt-4"
          style={{ fontFamily: "'Instrument Serif', serif", color: T.textTertiary, borderTop: `1px solid ${T.borderLight}` }}>
          It's just you and your efforts
        </p>
      </div>
    </div>
  );
}

// ── Landing ────────────────────────────────────────────────────────

function Landing({ wordmarkVariant }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: T.bg, border: `1px solid ${T.border}` }}>
      <div className="px-6 py-10 text-center">
        <div className="mb-1"><Wordmark variant={wordmarkVariant} fontSize={48} /></div>
        <p className="text-sm italic mb-6" style={{ fontFamily: "'Instrument Serif', serif", color: T.textTertiary }}>
          The sound you make at the top of the climb
        </p>
        <div className="rounded-xl p-6 mb-5 text-left max-w-sm mx-auto"
          style={{ background: T.surface, border: `1px solid ${T.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <h2 className="text-xl font-normal mb-1" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>
            Participation Awards
          </h2>
          <p className="text-sm italic mb-4" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>
            It's just you and your efforts
          </p>
          <p className="text-base mb-5 leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>
            Recognition for efforts where effort was given. Year bests, season firsts, and the patterns Strava doesn't celebrate.
          </p>
          <button className="w-full flex items-center justify-center gap-2 text-base font-semibold px-5 py-3 rounded-lg text-white"
            style={{ background: T.strava, fontFamily: "'DM Sans', sans-serif" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
            </svg>
            Connect with Strava
          </button>
        </div>
        <p className="text-sm" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>
          100% client-side — your data never leaves your browser.
        </p>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────

function Dashboard() {
  const acts = [
    { name: "Sunday Morning Climb", date: "Mar 8", meta: "42.3 km · 1:48:22 · 620m",
      awards: [{ type: "season_first", label: "3× Season First" }, { type: "year_best", label: "Year Best" }] },
    { name: "Commute — Expressway", date: "Mar 7", meta: "18.1 km · 0:42:10 · 85m",
      awards: [{ type: "consistency", label: "2× Metronome" }] },
    { name: "Weekend Valley Loop", date: "Mar 5", meta: "65.2 km · 2:34:50 · 840m",
      awards: [{ type: "top_decile", label: "Top 10%" }, { type: "recent_best", label: "Recent Best" }, { type: "monthly_best", label: "Monthly Best" }] },
  ];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: T.bg, border: `1px solid ${T.border}` }}>
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <div>
          <span className="text-lg" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Participation Awards</span>
          <span className="text-sm ml-2" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>Oskar Austegard</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm px-2.5 py-1.5 rounded-lg border font-medium"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.textSecondary, borderColor: T.border }}>km</span>
          <span className="text-sm px-4 py-1.5 rounded-lg text-white font-semibold"
            style={{ background: "#3B82F6", fontFamily: "'DM Sans', sans-serif" }}>Sync Now</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        {[{ n: "247", l: "Segments tracked" }, { n: "14", l: "Awards (recent 20)" }].map(s => (
          <div key={s.l} className="rounded-xl p-4 text-center"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="text-3xl font-normal" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>{s.n}</div>
            <div className="text-sm mt-1" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 space-y-3">
        <h2 className="text-lg" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Recent Activities</h2>
        {acts.map((act, i) => (
          <div key={i} className="rounded-xl p-4"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="text-base font-medium" style={{ fontFamily: "'DM Sans', sans-serif", color: T.text }}>{act.name}</div>
            <div className="text-sm mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.textTertiary }}>{act.date} · {act.meta}</div>
            {act.awards.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {act.awards.map(a => <AwardPill key={a.type} type={a.type} label={a.label} showIcon={true} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-center py-4"><span className="text-xs" style={{ color: T.textTertiary }}>Powered by Strava</span></div>
    </div>
  );
}

// ── Swatch ─────────────────────────────────────────────────────────

function Swatch({ color, name, contrast }) {
  const needsBorder = ["#FFFFFF", "#F6F3EE", "#FAF8F4"].includes(color);
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg flex-shrink-0 shadow-sm"
        style={{ background: color, border: needsBorder ? "1px solid #ddd" : "none" }} />
      <div>
        <div className="text-sm font-medium" style={{ color: T.text }}>{name}</div>
        <div className="text-xs font-mono" style={{ color: T.textTertiary }}>{color}</div>
        {contrast && <div className="text-xs" style={{ color: T.textTertiary }}>{contrast}</div>}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────

export default function TerrainStyleGuide() {
  const [wmVariant, setWmVariant] = useState("io");
  const [section, setSection] = useState("all");

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div className="min-h-screen" style={{ background: T.bg }}>
        <div className="max-w-4xl mx-auto px-4 py-8 md:px-8">

          <div className="mb-8">
            <h1 className="text-4xl font-normal mb-1" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>
              <span>aeyu</span><span style={{ color: T.accent }}>.io</span>
              <span className="text-2xl ml-3" style={{ color: T.textTertiary }}>Style Guide v2</span>
            </h1>
            <p className="text-base" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>
              Terrain warmth · Strava-compatible surfaces · Geometric badge icons · High-contrast type
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            {[["all","Everything"],["wordmark","Wordmark"],["type","Typography"],["palette","Palette"],["icons","Icons & Awards"],["card","Share Card"],["screens","Screens"]].map(([id, label]) => (
              <button key={id} onClick={() => setSection(id)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: section === id ? T.text : T.surface,
                  color: section === id ? T.textOnDark : T.textSecondary,
                  border: `1px solid ${section === id ? T.text : T.border}`,
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── WORDMARK ───────────────────────────────── */}
          {(section === "all" || section === "wordmark") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Wordmark</h2>
              <div className="rounded-xl p-8" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="flex gap-3 mb-8">
                  {[
                    { id: "plain", label: "No color" },
                    { id: "dot", label: "A — Colored dot" },
                    { id: "io", label: 'B — Colored ".io"' },
                  ].map(v => (
                    <button key={v.id} onClick={() => setWmVariant(v.id)}
                      className="px-3 py-1.5 rounded-lg text-sm"
                      style={{
                        background: wmVariant === v.id ? T.text : "transparent",
                        color: wmVariant === v.id ? T.textOnDark : T.textSecondary,
                        border: `1px solid ${T.border}`, fontFamily: "'DM Sans', sans-serif",
                      }}>{v.label}</button>
                  ))}
                </div>

                <div className="text-center mb-6">
                  <Wordmark variant={wmVariant} fontSize={64} />
                  <div className="text-lg mt-2" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textTertiary }}>
                    Participation Awards
                  </div>
                </div>

                {/* Wordmark in context sizes */}
                <div className="pt-6 mt-6 space-y-4" style={{ borderTop: `1px solid ${T.borderLight}` }}>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>
                    In context
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Header bar (18px)</span>
                    <Wordmark variant={wmVariant} fontSize={18} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Share card (16px)</span>
                    <Wordmark variant={wmVariant} fontSize={16} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Landing hero (48px)</span>
                    <Wordmark variant={wmVariant} fontSize={48} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TYPOGRAPHY ─────────────────────────────── */}
          {(section === "all" || section === "type") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Typography</h2>
              <div className="rounded-xl p-6" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="space-y-5">
                  <div>
                    <span className="text-xs uppercase tracking-widest" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Display — Instrument Serif</span>
                    <p className="text-3xl font-normal mt-1" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>
                      Giving recognition for efforts
                    </p>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-widest" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Body — DM Sans 16px min</span>
                    <p className="mt-1" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary, fontSize: 16 }}>
                      Your first effort on a segment this calendar year. Only awarded once per segment per year, on the ride that breaks the seal. Readable at arm's length after a ride.
                    </p>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-widest" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Data — IBM Plex Mono 14px min</span>
                    <p className="mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.textSecondary, fontSize: 14 }}>
                      4:32.18 · 42.3 km · 620m ↑ · 285W avg
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PALETTE ────────────────────────────────── */}
          {(section === "all" || section === "palette") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Palette</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl p-5" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="text-xs uppercase tracking-widest mb-3" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Surfaces</div>
                  <div className="space-y-3">
                    <Swatch color={T.bg} name="Page Background" contrast="Warm paper" />
                    <Swatch color={T.surface} name="Card Surface" contrast="White — Strava DNA" />
                    <Swatch color={T.border} name="Border" />
                  </div>
                </div>
                <div className="rounded-xl p-5" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="text-xs uppercase tracking-widest mb-3" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Text</div>
                  <div className="space-y-3">
                    <Swatch color={T.text} name="Primary" contrast="14.8:1 on white" />
                    <Swatch color={T.textSecondary} name="Secondary" contrast="6.2:1 — AA at 16px" />
                    <Swatch color={T.textTertiary} name="Tertiary" contrast="3.8:1 — AA Large" />
                  </div>
                </div>
                <div className="rounded-xl p-5 md:col-span-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="text-xs uppercase tracking-widest mb-3" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>Accents</div>
                  <div className="flex gap-8">
                    <Swatch color={T.strava} name="Strava Orange" contrast="CTA buttons only" />
                    <Swatch color={T.accent} name="Terracotta" contrast="aeyu brand accent + wordmark" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ICONS & AWARDS ─────────────────────────── */}
          {(section === "all" || section === "icons") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Icons & Awards</h2>

              {/* Icon grid */}
              <div className="rounded-xl p-6 mb-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-xs uppercase tracking-widest mb-4" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>
                  Inline SVG icons — geometric outlines in award color
                </div>
                <div className="grid grid-cols-4 md:grid-cols-5 gap-6">
                  {Object.entries({
                    "Season First": "season_first", "Year Best": "year_best", "Top 10%": "top_decile",
                    "Recent Best": "recent_best", "Metronome": "consistency", "Comeback": "comeback",
                    "Monthly Best": "monthly_best", "On a Roll": "improvement_streak",
                    "YTD Best": "ytd_best_time", "YTD Power": "ytd_best_power",
                    "Milestone": "milestone", "Top Quartile": "top_quartile",
                    "Beat Median": "beat_median", "Closing In": "closing_in",
                    "Anniversary": "anniversary",
                  }).map(([label, type]) => (
                    <div key={type} className="flex flex-col items-center gap-2">
                      <BadgeIcon type={type} size={32} />
                      <span className="text-xs text-center" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pills with icons */}
              <div className="rounded-xl p-6" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-xs uppercase tracking-widest mb-3" style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif" }}>
                  Pill badges — icon replaces colored dot
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {Object.entries({
                    "Season First": "season_first", "Year Best": "year_best", "Top 10%": "top_decile",
                    "Recent Best": "recent_best", "Metronome": "consistency", "Comeback": "comeback",
                    "Monthly Best": "monthly_best", "On a Roll": "improvement_streak",
                    "YTD Best": "ytd_best_time", "YTD Power": "ytd_best_power",
                    "Milestone": "milestone", "Top Quartile": "top_quartile",
                    "Beat Median": "beat_median", "Closing In": "closing_in", "Anniversary": "anniversary",
                  }).map(([label, type]) => (
                    <AwardPill key={type} type={type} label={label} size="lg" showIcon={true} />
                  ))}
                </div>
                <div className="text-xs uppercase tracking-widest mb-3 mt-6 pt-4"
                  style={{ color: T.textTertiary, fontFamily: "'DM Sans', sans-serif", borderTop: `1px solid ${T.borderLight}` }}>
                  With counts
                </div>
                <div className="flex flex-wrap gap-2">
                  <AwardPill type="season_first" label="3× Season First" size="lg" />
                  <AwardPill type="year_best" label="Year Best" size="lg" />
                  <AwardPill type="consistency" label="2× Metronome" size="lg" />
                </div>
              </div>
            </div>
          )}

          {/* ── SHARE CARD ─────────────────────────────── */}
          {(section === "all" || section === "card") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Share Card</h2>
              <ShareCard />
              <div className="mt-4 rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <p className="text-sm" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>
                  Icons appear both in award pills and as accent markers on segment detail lines. Canvas-rendered at 1080px wide, warm paper background with topo texture at 3% opacity. Activity name in Instrument Serif is the hero moment.
                </p>
              </div>
            </div>
          )}

          {/* ── SCREENS ────────────────────────────────── */}
          {(section === "all" || section === "screens") && (
            <div className="mb-10">
              <h2 className="text-2xl font-normal mb-4" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Screens</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium mb-2" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>Landing</div>
                  <Landing wordmarkVariant={wmVariant} />
                </div>
                <div>
                  <div className="text-sm font-medium mb-2" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>Dashboard</div>
                  <Dashboard />
                </div>
              </div>
            </div>
          )}

          {/* ── DECISIONS ──────────────────────────────── */}
          {section === "all" && (
            <div className="rounded-xl p-6" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <h2 className="text-xl font-normal mb-3" style={{ fontFamily: "'Instrument Serif', serif", color: T.text }}>Design Decisions</h2>
              <div className="space-y-3 text-base leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif", color: T.textSecondary }}>
                <p><strong style={{ color: T.text }}>Strava DNA, not clone.</strong> White cards, geometric sans body, Strava orange CTA. Warm page background + serif display + terracotta accent are the differentiators.</p>
                <p><strong style={{ color: T.text }}>Icons over dots.</strong> Geometric SVG outlines in the award's semantic color. Readable at 12px in pills, expressive at 32px in cards. Canvas-renderable for share images.</p>
                <p><strong style={{ color: T.text }}>Type floor: 14px mono, 16px body.</strong> Target audience reads on phones post-ride. DM Sans's wider letterforms help.</p>
                <p><strong style={{ color: T.text }}>Color = awards.</strong> Neutral UI means award pills are the brightest elements — no competition from chrome.</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
