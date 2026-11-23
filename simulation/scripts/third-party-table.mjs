#!/usr/bin/env node
/**
 * third-party-table.mjs — Regenera la tabla de recursos incorporados de
 * THIRD_PARTY_ASSETS.md a partir de assets/manifest.lock.json.
 *
 * Reemplaza solo el contenido entre los marcadores
 *   <!-- assets:start --> y <!-- assets:end -->
 * y deja intacto el resto del documento. Puede ejecutarse tantas veces como
 * se quiera (desde `simulation/`): node scripts/third-party-table.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(SIM_ROOT, 'assets', 'manifest.lock.json');
const DOC_PATH = path.join(SIM_ROOT, 'THIRD_PARTY_ASSETS.md');
const START = '<!-- assets:start -->';
const END = '<!-- assets:end -->';

/** Traducción de las contribuciones que publica Poly Haven. */
const CONTRIBUTIONS = { Photography: 'fotografía', Processing: 'procesado', Scanning: 'escaneo', Modelling: 'modelado' };

const escapeCell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');

function formatAuthors(authors) {
  if (!authors?.length) return '—';
  return authors
    .map(({ name, contribution }) =>
      contribution === 'All' ? name : `${name} (${CONTRIBUTIONS[contribution] ?? contribution})`,
    )
    .join(', ');
}

function buildTable(lock) {
  const rows = lock.textures.map((t) =>
    [
      `\`${t.id}\``,
      `\`${t.role}\``,
      formatAuthors(t.authors),
      t.license,
      `[${t.title ?? t.id}](${t.page})`,
      t.maxResolution,
    ]
      .map(escapeCell)
      .join(' | '),
  );
  return [
    '_Tabla generada desde `assets/manifest.lock.json` con `node scripts/third-party-table.mjs`; no editar a mano._',
    '',
    '| Textura | Rol | Autores | Licencia | Poly Haven | Resolución máx. |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
  ].join('\n');
}

async function main() {
  const lock = JSON.parse(await fs.readFile(LOCK_PATH, 'utf8'));
  if (!Array.isArray(lock.textures)) throw new Error('manifest.lock.json sin "textures".');

  const doc = await fs.readFile(DOC_PATH, 'utf8');
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start || doc.indexOf(START, start + 1) !== -1) {
    throw new Error(`THIRD_PARTY_ASSETS.md debe contener una sola pareja de marcadores ${START} … ${END}.`);
  }

  // Respeta el fin de línea del documento (LF o CRLF).
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const table = buildTable(lock).replaceAll('\n', eol);
  const updated = `${doc.slice(0, start + START.length)}${eol}${table}${eol}${doc.slice(end)}`;

  if (updated === doc) {
    console.log(`THIRD_PARTY_ASSETS.md ya estaba al día (${lock.textures.length} texturas).`);
    return;
  }
  await fs.writeFile(DOC_PATH, updated, 'utf8');
  console.log(`THIRD_PARTY_ASSETS.md actualizado: ${lock.textures.length} texturas.`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});
