// Exporta la vista SVG a PNG y PDF con Playwright, instalado en web-app.
const { chromium } = require('../../web-app/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1980, height: 1650 }, deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'diagrama.html')).href);
    await page.locator('#diagram > svg').screenshot({ path: path.join(__dirname, 'diagrama.png') });
    await page.locator('#in').click();
    if (await page.locator('#diagram').evaluate(el => el.style.width) !== '120%') {
      throw new Error('El botón de acercar no funciona');
    }
    await page.locator('#fit').click();
    if (await page.locator('#diagram').evaluate(el => el.style.width) !== '100%') {
      throw new Error('El botón de ajustar no funciona');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    const svg = fs.readFileSync(path.join(__dirname, 'diagrama.svg'), 'utf8');
    const [, width, height] = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
    await page.setContent(`<html><head><style>
      @page { size:${width}px ${height}px; margin:0 }
      html,body { margin:0; padding:0; width:${width}px; height:${height}px }
      svg { display:block }
    </style></head><body>${svg}</body></html>`);
    await page.pdf({
      path: path.join(__dirname, 'diagrama.pdf'), printBackground: true,
      preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    console.log('PNG y PDF exportados. Vista HTML y controles de zoom comprobados.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
