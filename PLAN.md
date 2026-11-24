# MediaHarbor – Project Plan (v2, updated)

**Goal:** a Chrome extension that finds every image and video on a page and saves it in the **best quality the site offers**, with a clean UI that works on desktop, tablet and phone-sized screens.

Status: **Phases 1–4 are built and tested.** Phase 5 is optional future work.

---

## 1. What changed in this version of the plan

| Area | Plan v1 | Plan v2 (built) |
|---|---|---|
| Quality | Pick biggest file | Quality engine: `srcset`, lazy-load attributes, site URL rules (X, Pinterest, Reddit, Wikimedia, Amazon, WordPress, Shopify, Google, Imgur, Flickr, Unsplash, Cloudinary, imgix), HLS/DASH best variant, social-media page data |
| Streams | Phase 2 idea | HLS (incl. AES-128) + DASH, video + audio joined into one MP4 with ffmpeg.wasm |
| Social sites | Phase 3 idea | Instagram, Facebook, Threads, X/Twitter, TikTok, plus JSON-LD on any site |
| UX | Popup only | Popup **and** a full-page manager with a responsive layout for desktop, tablet and phone widths |
| YouTube | Optional helper app | Not included. Videos are blocked by design; thumbnails still work (see Limits) |

---

## 2. UX design

### Two views, one design system
1. **Toolbar popup** (480 × 596 px): fast access while browsing.
2. **Full-page manager** (button "Open full view", or right-click → *Find all images & videos on this page*): a big grid, search, keyboard shortcuts.

### Responsive layout (manager)
| Screen | Width | Layout |
|---|---|---|
| Large desktop | ≥ 1400 px | Grid with 220 px cards, all tools in one row |
| Desktop / laptop | 900–1400 px | Grid with 200 px cards |
| Tablet | 600–900 px | 3–4 columns, smaller search box |
| Phone | < 600 px | 2 columns, full-width tabs, filters in a 2-column grid, settings open as a bottom sheet, icon-only buttons, 40 px touch targets, safe-area padding |
| Very small | < 360 px | 2 tight columns, fewer card buttons |

### Key UX decisions
- **Best quality first.** Default sort puts the largest videos and images on top. Badges show quality at a glance: `4K`, `1080p`, `720p`, `Full HD`, `HD`.
- **One clear main action.** A sticky bottom bar always shows what will happen ("Download all 9" or "Download 3") with the count and total size.
- **Status on every card.** Spinner while saving, green check when saved, red mark on error.
- **Stream progress panel.** Shows each video being processed ("Downloading parts 34 of 120", "Joining video and audio…"), with cancel. Successful jobs hide themselves after 6 seconds; errors stay visible.
- **Honest limits.** Protected (DRM) and live streams show a badge and a disabled button with a reason. YouTube shows a short notice.
- **Noise filter.** Tiny icons (< 120 px) are hidden by default; a minimum-size filter (300 px, 800 px, HD, Full HD) removes the rest.
- **Load more.** One button scrolls the page for 15 seconds so infinite feeds (Instagram, Pinterest) load more posts.
- **Preview.** Full-screen lightbox with arrow keys and swipe; copy link; open in a new tab.
- **Accessibility.** Keyboard: arrows move between cards, Space selects, Enter previews, D downloads, Ctrl/⌘+A selects all, Esc clears. Visible focus rings, ARIA labels, reduced-motion support, light and dark themes (follows the system by default).

---

## 3. Architecture

```
extension/
├── manifest.json            Manifest V3
├── background.js            Service worker: per-tab media list, network sniffing, downloads, jobs
├── shared/rules.js          Quality rules (thumbnail URL → original URL)
├── shared/extract.js        Reads Instagram / Facebook / X / TikTok / JSON-LD data
├── content/page-hook.js     Page world (social sites only): reads fetch/XHR JSON as you scroll
├── content/detector.js      Scans the DOM: img, srcset, picture, lazy attributes, video, links, CSS backgrounds, meta tags
├── offscreen/offscreen.js   HLS/DASH downloader, AES-128 decryption, ffmpeg.wasm merge
├── ui/                      Popup + manager (shared app.js / app.css)
└── vendor/                  ffmpeg.wasm (0.12)
```

**Data flow:** page scanner + network watcher → service worker list (saved in storage, so it survives Chrome stopping the worker) → UI over a live port → download via `chrome.downloads`, or a stream job in the offscreen document → finished file saved to `Downloads/MediaHarbor/<site>/`.

**Page changes:** every item is tagged with Chrome's document ID. When a new page loads in a tab, its list starts fresh. Late messages from the old page are ignored. Single-page apps such as Instagram keep their list while you scroll.

**Downloads that need the page as referrer:** a short-lived `declarativeNetRequest` rule adds the page's `Referer`/`Origin` only to the extension's own requests during a job.

---

## 4. Phases

| # | Phase | Status |
|---|---|---|
| 1 | Generic image/video finder, popup, single and bulk download | ✅ Done |
| 2 | HLS + DASH streams, AES-128, video + audio merge | ✅ Done |
| 3 | Site modules: Instagram, Facebook, Threads, X, TikTok, JSON-LD | ✅ Done |
| 4 | Responsive UX (popup + manager), settings, themes, tests | ✅ Done |
| 5 | Optional: ZIP export, download history page, more site rules, translations, Chrome Web Store listing | ⏳ Future |

---

## 5. Testing

- `node tests/unit.js`: 27 checks for the URL rules and the social-media extractor.
- `node tests/e2e.js`: loads the real extension in Chromium against a local test site and a fake Instagram feed. It checks detection, quality choice, DRM refusal, downloads, folder names, and uses `ffprobe` to confirm the merged MP4s have both video and audio (1080p HLS, 720p DASH, 1080×1920 Instagram reel). It also takes screenshots at popup, desktop, tablet and phone sizes in light and dark themes.

Last result: **34/34 end-to-end checks passed (3 runs in a row), 27/27 unit checks passed.**

---

## 6. Limits (by design or by law)

- **YouTube** and big streaming services (Netflix, Disney+, Prime Video, Hulu, Max, Spotify): video download is switched off. Google's Chrome Web Store rules do not allow YouTube downloaders, and these services use DRM.
- **DRM** (Widevine, FairPlay, PlayReady, SAMPLE-AES): never bypassed. Items are marked "Protected".
- **Live streams**: can be saved only after they end.
- **Phones:** Chrome on Android and iPhone does **not** support extensions. The phone layout is for narrow windows and Chromium browsers that can load Chrome extensions (not tested by me; this needs verification).
- **Site changes:** Instagram/Facebook/X/TikTok change their data often. Rules in `shared/extract.js` may need updates.
- **Very large videos** are processed in browser memory. Multi-GB files may fail.
