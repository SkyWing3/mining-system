// Capturas de revisión visual por perfil gráfico (F1.12). Se guardan en tests/output/screenshots.
import { test } from '@playwright/test'
import { openTwin, showOverview, showViewpoint, type Quality, type Viewpoint } from '../support/twin.ts'

const VIEWPOINTS: Array<{ name: string; view: Viewpoint }> = [
  { name: '01-socavon-entibado', view: { segment: 'S1', s: 9, pitch: -0.04 } },
  { name: '02-roca-rieles-servicios', view: { segment: 'S2', s: 4, pitch: -0.06 } },
  { name: '03-cruce-hacia-crucero', view: { segment: 'S2', s: 20, yawOffset: -0.35, pitch: -0.05 } },
  { name: '04-arcos-de-acero', view: { segment: 'S3', s: 12, pitch: -0.03 } },
  { name: '05-concreto-lanzado', view: { segment: 'S4', s: 18, pitch: -0.05 } },
  { name: '06-camara-de-carguio', view: { segment: 'S4', s: 37, pitch: 0.05 } },
  { name: '07-refugio', view: { segment: 'S6', s: 33, pitch: -0.02 } },
  { name: '08-pared-detalle', view: { segment: 'S2', s: 13, yawOffset: -1.25, pitch: 0.1, lateral: -0.6 } },
]

const qualities = (process.env.TWIN_QUALITIES ?? 'low,medium,high,ultra').split(',') as Quality[]

for (const quality of qualities) {
  test(`capturas en perfil ${quality}`, async ({ page }) => {
    await openTwin(page, quality)
    await showOverview(page)
    await page.screenshot({ path: `tests/output/screenshots/${quality}/00-supervision.png` })
    for (const { name, view } of VIEWPOINTS) {
      await showViewpoint(page, view)
      await page.screenshot({ path: `tests/output/screenshots/${quality}/${name}.png` })
    }
  })
}
