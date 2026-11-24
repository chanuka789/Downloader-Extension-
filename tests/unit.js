/* Unit tests for the quality rules and the social-media extractor. Run: node tests/unit.js */
const path = require('path');
require(path.join(__dirname, '..', 'extension', 'shared', 'rules.js'));
require(path.join(__dirname, '..', 'extension', 'shared', 'extract.js'));
const R = globalThis.MHRules;
const X = globalThis.__mediaHarborExtract;

let failed = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

// ---------------- URL upgrade rules ----------------
const up = (u) => R.upgrade(u).url;
eq(up('https://pbs.twimg.com/media/AbC123?format=jpg&name=small'), 'https://pbs.twimg.com/media/AbC123?format=jpg&name=orig', 'X image -> original');
eq(up('https://i.pinimg.com/236x/aa/bb/cc/abc.jpg'), 'https://i.pinimg.com/originals/aa/bb/cc/abc.jpg', 'Pinterest -> originals');
eq(up('https://preview.redd.it/xyz.jpg?width=640&auto=webp&s=1'), 'https://i.redd.it/xyz.jpg', 'Reddit preview -> i.redd.it');
eq(up('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg'), 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat.jpg', 'Wikimedia thumb -> original');
eq(up('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', 'YouTube thumbnail -> maxres');
eq(up('https://m.media-amazon.com/images/I/81abc._AC_SX300_.jpg'), 'https://m.media-amazon.com/images/I/81abc.jpg', 'Amazon -> full size');
eq(up('https://example.com/wp-content/uploads/2024/01/photo-300x200.jpg'), 'https://example.com/wp-content/uploads/2024/01/photo.jpg', 'WordPress size -> original');
eq(up('https://lh3.googleusercontent.com/abc=w200-h200-c'), 'https://lh3.googleusercontent.com/abc=s0', 'Google content -> s0');
eq(up('https://i.imgur.com/AbCdEfGm.jpg'), 'https://i.imgur.com/AbCdEfG.jpg', 'Imgur thumb -> full');
eq(R.upgrade('https://example.com/a.jpg').fallback, null, 'unknown site unchanged (no fallback)');
eq(R.upgrade('https://i.pinimg.com/236x/a.jpg').fallback, 'https://i.pinimg.com/236x/a.jpg', 'upgraded URL keeps original as fallback');
eq(R.kindFromUrl('https://x.com/a/master.m3u8?t=1'), 'hls', 'detects HLS');
eq(R.kindFromUrl('https://x.com/a/manifest.mpd'), 'dash', 'detects DASH');
eq(R.isBlockedVideoHost('www.youtube.com'), true, 'YouTube video blocked');
eq(R.isBlockedVideoHost('instagram.com'), false, 'Instagram allowed');

// ---------------- extractor ----------------
const kinds = (list) => list.map((i) => `${i.kind}:${i.url.slice(0, 70)}:${i.width || 0}x${i.height || 0}`);

// Instagram photo post (private API shape)
eq(kinds(X.extract({ items: [{ code: 'C1', user: { username: 'ann' }, image_versions2: { candidates: [
  { url: 'https://scontent.cdninstagram.com/s640.jpg', width: 640, height: 800 },
  { url: 'https://scontent.cdninstagram.com/s1440.jpg', width: 1440, height: 1800 }] } }] })),
['image:https://scontent.cdninstagram.com/s1440.jpg:1440x1800'], 'Instagram photo: largest candidate');

// Instagram carousel with a video + DASH manifest
const mpd = '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><Representation id="v1" width="1080" height="1920" bandwidth="3000000"><BaseURL>https://v.cdninstagram.com/v1.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>';
const car = X.extract({ carousel_media: [
  { image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/a.jpg', width: 1080, height: 1080 }] } },
  { id: '99', image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/poster.jpg', width: 1080, height: 1920 }] },
    video_versions: [{ url: 'https://v.cdninstagram.com/low.mp4', width: 480, height: 854, type: 101 }, { url: 'https://v.cdninstagram.com/hi.mp4', width: 720, height: 1280, type: 103 }],
    video_dash_manifest: mpd }
] });
eq(kinds(car), ['image:https://scontent.cdninstagram.com/a.jpg:1080x1080', 'video:https://v.cdninstagram.com/hi.mp4:720x1280', 'dash:mpd:99:1080x1920'], 'Instagram carousel: photo + best MP4 + 1080p DASH (no poster duplicate)');
eq(car[1].thumb, 'https://scontent.cdninstagram.com/poster.jpg', 'Instagram video gets its poster as thumbnail');

// Facebook video (HD preferred over SD)
eq(kinds(X.extract({ data: { video: { id: '55', browser_native_sd_url: 'https://video.fbcdn.net/sd.mp4', browser_native_hd_url: 'https://video.fbcdn.net/hd.mp4', width: 1920, height: 1080 } } })),
  ['video:https://video.fbcdn.net/hd.mp4:1920x1080'], 'Facebook: HD URL chosen');
eq(kinds(X.extract({ v: { playable_url: 'https://video.fbcdn.net/sd.mp4', playable_url_quality_hd: null } })),
  ['video:https://video.fbcdn.net/sd.mp4:0x0'], 'Facebook: SD used when no HD');
eq(kinds(X.extract({ photo: { image: { uri: 'https://scontent.xx.fbcdn.net/p.jpg', width: 2048, height: 1365 } }, icon: { uri: 'https://scontent.xx.fbcdn.net/i.png', width: 40, height: 40 } })),
  ['image:https://scontent.xx.fbcdn.net/p.jpg:2048x1365'], 'Facebook photo found, small icon ignored');

// X / Twitter video: highest bitrate MP4
eq(kinds(X.extract({ extended_entities: { media: [{ id_str: '1', type: 'video', media_url_https: 'https://pbs.twimg.com/t.jpg', video_info: { variants: [
  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl.m3u8' },
  { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/vid/640x360/a.mp4' },
  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/vid/1280x720/b.mp4' }] } }] } })),
['video:https://video.twimg.com/vid/1280x720/b.mp4:1280x720'], 'X video: highest bitrate MP4');

// TikTok
eq(kinds(X.extract({ itemInfo: { itemStruct: { video: { id: '7', playAddr: 'https://v16.tiktokcdn.com/low.mp4', cover: 'https://p.tiktokcdn.com/c.jpg', width: 576, height: 1024,
  bitrateInfo: [{ Bitrate: 500000, PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/500.mp4'], Width: 576, Height: 1024 } }, { Bitrate: 1500000, PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/1500.mp4'], Width: 1080, Height: 1920 } }] } } } })),
['video:https://v16.tiktokcdn.com/1500.mp4:1080x1920'], 'TikTok: highest bitrate');

// JSON-LD
eq(kinds(X.extract({ '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Clip', contentUrl: 'https://cdn.example.com/clip.mp4' })),
  ['video:https://cdn.example.com/clip.mp4:0x0'], 'JSON-LD VideoObject');

// Facebook "for (;;);" responses and JSON lines
eq(X.parseLoose('for (;;);{"a":1}').length, 1, 'parses for(;;); prefix');
eq(X.parseLoose('{"a":1}\n{"b":2}\n').length, 2, 'parses JSON lines');
eq(X.mightContainMedia('{"hello":"world"}'), false, 'skips unrelated responses quickly');

// ---------------- Instagram posts grouped for the in-page buttons ----------------
const posts = X.extractPosts({ items: [{ pk: '1', code: 'CAR', user: { username: 'ann' }, carousel_media: [
  { pk: '11', image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/a_n.jpg?stp=s640', width: 640, height: 640 }, { url: 'https://scontent.cdninstagram.com/v/a_n.jpg?stp=s1080', width: 1080, height: 1080 }] } },
  { pk: '12', image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/cover_n.jpg', width: 1080, height: 1920 }] },
    video_versions: [{ url: 'https://v.cdninstagram.com/v/clip.mp4', width: 720, height: 1280 }], video_dash_manifest: mpd }] }] });
eq(posts.length, 1, 'Instagram carousel = one post (slides are not separate posts)');
eq(posts[0].media.map((m) => m.kind), ['image', 'dash'], 'carousel media in order; 1080p DASH preferred over 720p MP4');
eq(posts[0].media[0].file, 'a_n.jpg', 'image file name kept for matching the visible slide');
eq(posts[0].media[1].thumbFile, 'cover_n.jpg', 'video cover file name kept for matching');
const legacy = X.extractPosts({ shortcode_media: { shortcode: 'OLD1', id: '5', owner: { username: 'bob' }, edge_sidecar_to_children: { edges: [
  { node: { display_url: 'https://x.cdninstagram.com/1.jpg', dimensions: { width: 1080, height: 1350 } } },
  { node: { is_video: true, video_url: 'https://x.cdninstagram.com/2.mp4', display_url: 'https://x.cdninstagram.com/2.jpg', dimensions: { width: 720, height: 1280 } } }] } } });
eq(legacy.map((p) => [p.code, p.user, p.media.map((m) => m.kind).join('+')]), [['OLD1', 'bob', 'image+video']], 'older Instagram data format (GraphQL sidecar) also works');

console.log(failed ? `\n${failed} test(s) failed` : '\nAll unit tests passed');
process.exitCode = failed ? 1 : 0;
