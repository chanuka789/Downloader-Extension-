// Renders tools/icon.svg to PNG icons with the pre-installed Chromium.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'extension', 'icons', `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
