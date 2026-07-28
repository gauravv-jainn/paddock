# 06 — Livestream Integration (YouTube)

**Status:** Complete.
**Brief said:** *"Research methods to automatically discover official or publicly available YouTube live streams associated with races. Never require manual updates."*
**Finding:** partially achievable. The "never require manual updates" constraint is the part that fails, and it fails on hard API economics rather than on effort.

---

## 1. What actually exists on YouTube

Verified findings:

| Source | Reality |
|---|---|
| **Keeneland (US)** | Confirmed. Broadcasts full race cards live on its own YouTube channel, alongside its site, app, and FanDuel. A genuine, free, embeddable full-card stream. |
| **Sky Sports Racing / At The Races** | Has an official YouTube channel, but it broadcasts live racing on **Sky 415 / Virgin 512** — television. The YouTube channel carries shows, previews and highlights, not the live card. |
| **UK & Irish racing generally** | Paywalled. Racing TV and Sky Sports Racing hold the rights. Bookmaker streams (e.g. William Hill) require a registered and sometimes funded account. **This will not be on public YouTube, ever.** |
| **Other US tracks** | Patchy. Some stream free; most route through TVG/FanDuel or track-specific players. |
| **JRA (Japan), HKJC (Hong Kong)** | Strong official YouTube presence; live-card availability varies by meeting and is often geo-restricted. |
| **Indian racing clubs** | Several stream on YouTube. Coverage is inconsistent and channel naming is not standardised. |

**Conclusion:** a *minority* of races have a free, legitimate, embeddable YouTube live stream. The correct design assumption is **video is a bonus, present sometimes, and the product must be complete without it.**

---

## 2. Why full auto-discovery fails

The YouTube Data API v3 quota economics are decisive.

| Fact | Value |
|---|---|
| Default project quota | **10,000 units/day** |
| `search.list` cost | **100 units per call** |
| Effective search budget | **100 searches per day, total, across the entire platform** |
| `videos.list`, `playlistItems.list` | **1 unit** per call |
| Paid upgrade | **None available self-service.** Extra quota requires an audit form, manual Google review, no guaranteed timeline, and use cases involving bulk harvesting are frequently rejected. |
| Reset | Midnight Pacific, no rollover |

A naive design — "for each of today's races, search YouTube for the track name" — with 30 UK/IRE races plus 40 US races per day would exhaust the entire daily quota before lunch, every day, permanently, with no upgrade path.

**This is the constraint that kills "never require manual updates."** Not laziness — arithmetic.

---

## 3. The design that works

Invert it. Curate **channels** (few, stable, human-verified once). Automate **broadcasts** (many, changing daily, resolved at 1 unit each).

```
┌────────────────────────────────────────────────────────┐
│  CHANNEL REGISTRY        (DB table, human-curated)     │
│  ~40 rows. track_id → youtube_channel_id.              │
│  Changes maybe twice a year.                           │
└──────────────────────┬─────────────────────────────────┘
                       │
      ┌────────────────▼──────────────────┐
      │  DAILY SWEEP  (once, 06:00 local) │
      │  For each registered channel:     │
      │    playlistItems.list on the      │
      │    channel's uploads playlist     │
      │    → 1 unit each                  │
      │  Cost: ~40 units/day              │
      └────────────────┬──────────────────┘
                       │  candidate video IDs
      ┌────────────────▼──────────────────┐
      │  ENRICH                            │
      │  videos.list (batched, 50 IDs)     │
      │  part=snippet,status,contentDetails│
      │    liveBroadcastContent = 'live'   │
      │    status.embeddable = true        │
      │    regionRestriction               │
      │  Cost: ~3 units/day                │
      └────────────────┬──────────────────┘
                       │
      ┌────────────────▼──────────────────┐
      │  MATCH → race_streams              │
      │  channel→track + broadcast window  │
      │  vs race.off_time                  │
      └────────────────────────────────────┘
```

**Total quota consumption: under 100 units/day.** Roughly 1% of the free allocation, leaving 99% of headroom for growth, retries, and the occasional discovery search.

### 3.1 The discovery budget

Reserve **20 `search.list` calls per day** (2,000 units) for a low-frequency job that hunts for *new* channels — searching one unmapped track name per day on rotation. Results go to an **admin review queue**, never straight to production. A human confirms "yes, that is the official Keeneland channel" once, and it is registered forever.

This is the honest version of automation: automate the daily churn, curate the stable set. Attempting to automate channel identity is how a platform ends up embedding an unofficial re-stream, which is both a rights violation and a quality problem.

---

## 4. Schema

```sql
CREATE TABLE stream_channels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id            UUID REFERENCES tracks(id),
  country_code        CHAR(2),
  platform            TEXT NOT NULL DEFAULT 'youtube',
  channel_id          TEXT NOT NULL,
  uploads_playlist_id TEXT,                   -- cached; avoids a channels.list call
  is_official         BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by         UUID REFERENCES users(id),
  verified_at         TIMESTAMPTZ,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (platform, channel_id)
);

CREATE TABLE race_streams (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id        UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  channel_id     UUID NOT NULL REFERENCES stream_channels(id),
  video_id       TEXT NOT NULL,
  embeddable     BOOLEAN NOT NULL,
  blocked_regions TEXT[] NOT NULL DEFAULT '{}',
  allowed_regions TEXT[],
  live_from      TIMESTAMPTZ,
  live_until     TIMESTAMPTZ,
  confidence     TEXT NOT NULL CHECK (confidence IN ('verified','matched','guessed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (race_id, video_id)
);
```

**`confidence` gates the UI.** `verified` and `matched` render the player. `guessed` renders a link with a "may not be this race" label, or nothing at all. Never present an uncertain match as the official broadcast.

---

## 5. Embedding

Use the **YouTube IFrame Player API**, not a bare `<iframe>` — you need the player state events to detect a failed embed and fall back cleanly.

```ts
// Must all be true before rendering the player
const canEmbed =
  stream.embeddable === true &&
  !stream.blocked_regions.includes(userRegion) &&
  (stream.allowed_regions === null || stream.allowed_regions.includes(userRegion)) &&
  stream.confidence !== 'guessed';
```

**Non-negotiable rules:**
- **No autoplay with sound.** Ever. Muted autoplay only, with an unmute affordance.
- **Use `youtube-nocookie.com`** for the privacy-enhanced mode.
- **Never proxy, re-host, download, or strip the stream.** That is a rights violation and a ToS termination.
- **Never overlay bet controls on the video in a way that obscures YouTube branding** — that breaches the embed terms.
- **Handle `onError` (codes 101/150 = embedding disabled by owner)** by falling back within one animation frame. A dead black rectangle is worse than no player.
- Lazy-load the IFrame API. It is heavy and most races will not have a stream.

---

## 6. Fallback ladder

The brief is right that this must degrade gracefully. Order of preference:

1. **Embedded live stream** — `verified`/`matched`, embeddable, region-permitted
2. **External link** — stream exists but embedding disabled or region-blocked: open on YouTube in a new tab, clearly labelled
3. **Live race tracker** — animated positional data if the provider supplies in-running positions
4. **Live text commentary** — sequential position updates rendered as a timeline
5. **Static race context** — going, distance, field, market movement chart, silks. Odds movement in the final 5 minutes is genuinely interesting content and costs nothing extra.
6. **Result card** — post-race: finishing order, distances, SP, dividends

**Never fabricate a stream.** No placeholder video, no "stream loading" that never resolves, no stock racing footage. The brief states this correctly and it is worth restating: an honest empty state is more premium than a fake full one.

---

## 7. Compliance notes

- The YouTube API Services Terms of Service apply, including required attribution and the prohibition on circumventing embed restrictions.
- If a rights-holder requests removal of their channel from the registry, the `active` flag must make that a one-row update.
- Do not build features that depend on video being present. Video availability will change without notice as rights deals shift.
- Extra quota requests are reviewed by Google against ToS compliance and use-case legitimacy. A paper-trading platform that embeds official channels and does not harvest data in bulk is a defensible application; a scraper is not. **Design for the audit you might have to pass.**

---

## 8. Effort estimate

| Task | Estimate |
|---|---|
| Channel registry + admin CRUD | 2 days |
| Daily sweep + enrichment worker | 3 days |
| Race↔stream matching heuristics | 3 days |
| Player component + fallback ladder | 3 days |
| Discovery job + review queue | 2 days |
| **Total** | **~13 days** |

For a feature that will have a stream available for a minority of races. Worth doing in Phase 1 — not worth doing before settlement is correct.
