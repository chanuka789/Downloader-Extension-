# Store images

Re-create the Chrome Web Store images in `docs/store/`:

```bash
SP=$(mktemp -d)
python3 tools/store/make_demo_images.py $SP/demo        # original demo photos
cp tools/store/demo-pages/* $SP/demo/                   # demo blog + feed pages
# demo video + stream (from the demo photos):
(cd $SP/demo && ffmpeg -y -loop 1 -i alpine-lake-4k.jpg -f lavfi -i sine=frequency=220 -t 5 \
  -vf "scale=3840:2160,zoompan=z='1+0.0015*on':d=125:s=1920x1080:fps=25" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest mountain-flight.mp4 && \
  mkdir -p hls && ffmpeg -y -loop 1 -i coast-sunset.jpg -f lavfi -i sine=frequency=330 -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac \
  -vf scale=1920:1080 -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename 'hls/v_%03d.ts' hls/master.m3u8)
node tools/store/capture.js $SP/demo $SP/caps            # real UI captures at 2x
node tools/store/compose.js $SP/caps docs/store          # 1280x800 slides + promo tiles
python3 -c "from PIL import Image;import glob;[Image.open(f).convert('RGB').save(f) for f in glob.glob('docs/store/*.png')]"
```
