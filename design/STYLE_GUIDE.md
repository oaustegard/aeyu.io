# aeyu.io Style Guide — Terrain v2

Design direction established 2026-03-08. Warm Terrain palette with Strava-compatible surfaces.

## Design Principles

1. **Strava DNA, not clone.** White card surfaces, geometric sans body, Strava orange CTA. Warm page background + serif display + terracotta accent are the differentiators.
2. **Icons over dots.** Geometric SVG outlines in each award's semantic color. Readable at 12px in pills, expressive at 32px in cards. Canvas-renderable for share images.
3. **Type floor: 14px mono, 16px body.** Target audience is 35+ cyclists reading on phones post-ride. DM Sans's wider letterforms help.
4. **Color = awards.** Neutral UI means award pills are the brightest elements — no competition from chrome.

## Wordmark

- Font: Instrument Serif, regular weight
- Color treatment: `aeyu` in text color, `.io` in terracotta (#B85A28)
- Fallback: all text color (no color accent) at small sizes where the terracotta might not register

## Typography

| Role     | Font             | Min Size | Weight      | Notes                                    |
|----------|------------------|----------|-------------|------------------------------------------|
| Display  | Instrument Serif | 24px     | 400         | Headlines, wordmark, section titles       |
| Body     | DM Sans          | 16px     | 400/500/600 | Geometric sans, Strava-compatible         |
| Data     | IBM Plex Mono    | 14px     | 400         | Times, distances, dates, metrics          |

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Instrument+Serif&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap
```

## Surfaces

| Token          | Value     | Usage                                    |
|----------------|-----------|------------------------------------------|
| `--bg`         | `#F6F3EE` | Page background (warm paper)             |
| `--surface`    | `#FFFFFF` | Card surfaces (Strava DNA — white)       |
| `--surface-hover` | `#FAF8F4` | Card hover state                      |
| `--border`     | `#E5DFD4` | Card borders, dividers                   |
| `--border-light` | `#EDE8E0` | Subtle internal dividers               |

## Text Colors

| Token              | Value     | Contrast on white | Usage                        |
|--------------------|-----------|-------------------|------------------------------|
| `--text`           | `#1A1610` | 14.8:1            | Primary text, headings       |
| `--text-secondary` | `#5C5548` | 6.2:1 (AA)        | Body text, descriptions      |
| `--text-tertiary`  | `#8C8374` | 3.8:1 (AA Large)  | Muted labels, timestamps     |
| `--text-on-dark`   | `#FAF7F2` | —                 | Text on dark backgrounds     |

## Accent Colors

| Token      | Value     | Usage                           |
|------------|-----------|----------------------------------|
| `--strava` | `#FC4C02` | CTA buttons, "Connect with Strava" |
| `--strava-hover` | `#E04400` | CTA hover                   |
| `--accent` | `#B85A28` | aeyu brand terracotta, wordmark  |

## Award Color System

Each award has four tokens: `dot` (icon/indicator color), `bg` (pill background), `text` (pill text), `border` (pill border).

| Award               | Dot       | Background | Text      | Border    |
|----------------------|-----------|------------|-----------|-----------|
| `season_first`       | `#3D7A4A` | `#E8F2E6`  | `#1E4D28` | `#C0D8B8` |
| `year_best`          | `#B8862E` | `#FBF0D8`  | `#6E5010` | `#E8D4A0` |
| `top_decile`         | `#B85A28` | `#F8E4D4`  | `#7A3418` | `#E8C0A4` |
| `recent_best`        | `#4882A8` | `#E4EEF6`  | `#2A5470` | `#B8D0E4` |
| `consistency`        | `#6B6260` | `#ECEAE6`  | `#3E3A36` | `#D4D0C8` |
| `comeback`           | `#A05060` | `#F4E4E8`  | `#6E2E3C` | `#DCC0C8` |
| `monthly_best`       | `#C08020` | `#FAF0D8`  | `#785010` | `#E8D8A8` |
| `improvement_streak` | `#3D7A4A` | `#E4F0E4`  | `#204E28` | `#B8D4B0` |
| `ytd_best_time`      | `#9C6E18` | `#F8ECD0`  | `#5E4010` | `#E0CCA0` |
| `ytd_best_power`     | `#B85030` | `#F6DED4`  | `#7A2E18` | `#E4B8A4` |
| `milestone`          | `#8C7A30` | `#F4EEDA`  | `#5C5018` | `#DCD4A8` |
| `top_quartile`       | `#5B6CA0` | `#E4E8F2`  | `#34406A` | `#BCC4DC` |
| `beat_median`        | `#7A5C8A` | `#ECE4F0`  | `#4A3060` | `#CCC0D8` |
| `closing_in`         | `#A04880` | `#F2E0EC`  | `#6A2858` | `#D8B8D0` |
| `anniversary`        | `#6B5CA0` | `#E8E4F4`  | `#3E3070` | `#C4BCD8` |

### Power Awards (Epic #43)

| Award                | Dot       | Background | Text      | Border    |
|----------------------|-----------|------------|-----------|-----------|
| `np_year_best`       | `#B8862E` | `#FBF0D8`  | `#6E5010` | `#E8D4A0` |
| `np_recent_best`     | `#4882A8` | `#E4EEF6`  | `#2A5470` | `#B8D0E4` |
| `work_energy`        | `#C08020` | `#FAF0D8`  | `#785010` | `#E8D8A8` |
| `work_year_best`     | `#C08020` | `#FAF0D8`  | `#785010` | `#E8D8A8` |
| `peak_power`         | `#A03020` | `#F6DCD4`  | `#6E1810` | `#E4B0A4` |
| `indoor`             | `#B85A28` | `#F8E4D4`  | `#7A3418` | `#E8C0A4` |
| `indoor_power`       | `#B85A28` | `#F8E4D4`  | `#7A3418` | `#E8C0A4` |
| `trainer_streak`     | `#B85A28` | `#F8E4D4`  | `#7A3418` | `#E8C0A4` |
| `power_sprint`       | `#C08020` | `#FAF0D8`  | `#785010` | `#E8D8A8` |
| `power_short`        | `#B85A28` | `#F8E4D4`  | `#7A3418` | `#E8C0A4` |
| `power_vo2max`       | `#A05060` | `#F4E4E8`  | `#6E2E3C` | `#DCC0C8` |
| `power_threshold`    | `#7A5C3C` | `#F0E8DC`  | `#4A3420` | `#D8CCC0` |
| `power_endurance`    | `#5B7BA3` | `#E4ECF4`  | `#2E4A6A` | `#B8CCD8` |
| `watt_milestone`     | `#8C7A30` | `#F4EEDA`  | `#5C5018` | `#DCD4A8` |
| `kj_milestone`       | `#C08020` | `#FAF0D8`  | `#785010` | `#E8D8A8` |
| `power_progression`  | `#3D7A4A` | `#E4F0E4`  | `#204E28` | `#B8D4B0` |
| `power_consistency`  | `#6B6260` | `#ECEAE6`  | `#3E3A36` | `#D4D0C8` |

## Badge Icons

Geometric SVG outlines, one color per icon (the award's `dot` color). All icons use consistent stroke width and follow a 24×24 viewBox.

| Award               | Icon Description          |
|----------------------|---------------------------|
| `season_first`       | Sprouting seedling         |
| `year_best`          | Five-pointed star          |
| `top_decile`         | Double chevron up          |
| `recent_best`        | Upward trend arrow         |
| `consistency`        | Three horizontal bars      |
| `comeback`           | Return/refresh arrow       |
| `monthly_best`       | Calendar with star         |
| `improvement_streak` | Ascending steps            |
| `ytd_best_time`      | Clock face                 |
| `ytd_best_power`     | Lightning bolt             |
| `milestone`          | Flag on mountain peak      |
| `top_quartile`       | Single chevron up          |
| `beat_median`        | Diamond                    |
| `closing_in`         | Bullseye/target            |
| `anniversary`        | Circular arrow             |
| `distance_record`    | Horizontal arrow           |
| `elevation_record`   | Mountain range polyline    |
| `segment_count`      | Hash/grid                  |
| `endurance_record`   | Stopwatch                  |
| `best_month_ever`    | Star in circle             |

### Power Award Icons (Epic #43)

| Award                | Icon Description                              |
|----------------------|-----------------------------------------------|
| `indoor`             | House outline with wheel inside               |
| `indoor_power`       | House outline with lightning bolt inside       |
| `trainer_streak`     | House outline with streak lines inside        |
| `work_energy`        | Gauge/meter dial                              |
| `work_year_best`     | Gauge dial at max with top tick               |
| `peak_power`         | Lightning bolt with radiating burst lines     |
| `power_sprint`       | 8-point starburst (explosive, 5s)             |
| `power_short`        | Bold upward block arrow (1min)                |
| `power_vo2max`       | Heart outline with upward arrow (5min)        |
| `power_threshold`    | Bar with ascending trend line + arrow (20min) |
| `power_endurance`    | Infinity symbol (sustained, 60min)            |
| `np_year_best`       | Star inside power ring (NP annual best)       |
| `np_recent_best`     | Small bolt with trend arrow (NP recent)       |
| `watt_milestone`     | Lightning bolt on pedestal                    |
| `kj_milestone`       | Gauge dial on pedestal base                   |
| `power_progression`  | Ascending trend line with bolt at origin      |
| `power_consistency`  | Gentle parallel wave lines (low variance)     |

See `design/style-guide.jsx` for live rendering with all SVG paths.

## Share Card Spec

- Canvas dimensions: 1080px wide, dynamic height
- Background: `#F6F3EE` with topo contour SVG texture at 3% opacity
- Wordmark top-left: Instrument Serif 28px, terracotta `.io`
- "Participation Awards" top-right: DM Sans 28px, tertiary color
- Divider: 1px `#E5DFD4`
- Activity name: Instrument Serif bold 52px, primary text
- Metadata: IBM Plex Mono 30px, secondary text
- Award pills: icon + label, same treatment as in-app
- Segment lines: SVG icon marker + segment name + time, colored accent bar
- Tagline: Instrument Serif italic 24px, tertiary color, bottom

## CSS Variables (for implementation)

```css
:root {
  /* Surfaces */
  --bg: #F6F3EE;
  --surface: #FFFFFF;
  --surface-hover: #FAF8F4;
  --border: #E5DFD4;
  --border-light: #EDE8E0;

  /* Text */
  --text: #1A1610;
  --text-secondary: #5C5548;
  --text-tertiary: #8C8374;
  --text-on-dark: #FAF7F2;

  /* Accents */
  --strava: #FC4C02;
  --strava-hover: #E04400;
  --accent: #B85A28;

  /* Fonts */
  --font-display: 'Instrument Serif', serif;
  --font-body: 'DM Sans', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
}
```
