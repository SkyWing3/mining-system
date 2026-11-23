#!/usr/bin/env node
/**
 * fetch-assets.mjs — Pipeline de texturas PBR CC0 (tarea F1.2).
 *
 * Descarga desde Poly Haven las texturas declaradas en `assets/manifest.json`,
 * verifica su integridad (MD5 publicado por la API y SHA-256 propio), genera
 * las variantes de ejecución 1k/2k/4k con sharp y escribe:
 *   - `assets/manifest.lock.json` (versionado): procedencia, autores, licencia,
 *     hashes de cada descarga y de cada variante producida.
 *   - `<outputDir>/index.json` (no versionado): catálogo que lee la aplicación.
 *
 * La aplicación nunca depende de un CDN en tiempo de ejecución: todo lo que
 * consume queda en `apps/twin-web/public/content/textures/`.
 *
 * Uso (desde `simulation/`):
 *   node scripts/fetch-assets.mjs              descarga (o reutiliza la caché) y genera variantes
 *   node scripts/fetch-assets.mjs --only a,b   limita el proceso a esos ids
 *   node scripts/fetch-assets.mjs --verify     verifica caché y variantes contra el lock, sin red
 *
 * Dependencias: solo módulos de Node y `sharp`.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(SIM_ROOT, 'assets', 'manifest.json');
const LOCK_PATH = path.join(SIM_ROOT, 'assets', 'manifest.lock.json');
const CACHE_DIR = path.join(SIM_ROOT, 'assets', 'cache');

const API_BASE = 'https://api.polyhaven.com';
const USER_AGENT = 'mining-digital-twin-asset-fetch';
const LICENSE = 'CC0-1.0';
const LOCK_VERSION = 1;
const INDEX_VERSION = 1;
const POLYHAVEN_TYPE_TEXTURE = 1;

/** Resoluciones conocidas, de menor a mayor. */
const RESOLUTIONS = ['1k', '2k', '4k', '8k', '16k'];
/** Resolución mínima de las variantes de ejecución. */
const MIN_RUNTIME_RESOLUTION = '1k';

const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 30_000;
/** Se aborta una descarga si no llega ningún dato durante este tiempo. */
const IDLE_TIMEOUT_MS = 60_000;
const ALLOWED_HOST_SUFFIXES = ['polyhaven.org', 'polyhaven.com'];

/**
 * Mapas de ejecución: nombre de salida, clave en la API de Poly Haven y
 * parámetros de codificación para las reducciones. Los mapas de datos
 * (normal, ARM) usan 4:4:4 para no mezclar canales independientes.
 */
const RUNTIME_MAPS = [
  { name: 'albedo', apiKey: 'Diffuse', quality: 90, chromaSubsampling: '4:2:0' },
  { name: 'normal', apiKey: 'nor_gl', quality: 95, chromaSubsampling: '4:4:4' },
  { name: 'arm', apiKey: 'arm', quality: 90, chromaSubsampling: '4:4:4' },
];

/** Mapas sueltos para construir el ARM cuando la API no lo ofrece. */
const ARM_FALLBACK = { ao: 'AO', rough: 'Rough', metal: 'Metal' };
const GENERATED_ARM_QUALITY = 95;

// ---------------------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------------------

/** Error que no debe reintentarse (HTTP 4xx definitivo, datos inválidos). */
class PermanentError extends Error {}

class HttpError extends Error {
  constructor(url, status, statusText) {
    super(`HTTP ${status} ${statusText} en ${url}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toPosix = (p) => p.split(path.sep).join('/');
const relFromSim = (p) => toPosix(path.relative(SIM_ROOT, p));
const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const resIndex = (res) => RESOLUTIONS.indexOf(res);

function describeError(err) {
  const cause = err?.cause ? ` (${err.cause.code ?? err.cause.message ?? err.cause})` : '';
  return `${err?.message ?? err}${cause}`;
}

/** Resuelve `rel` dentro de `base` y rechaza rutas que escapen de él. */
function resolveInside(base, rel) {
  const full = path.resolve(base, rel);
  const relative = path.relative(base, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PermanentError(`Ruta fuera de ${base}: ${rel}`);
  }
  return full;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

/** Escritura atómica de JSON (archivo temporal + renombrado). */
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, p);
}

/** Calcula MD5, SHA-256 y tamaño de un archivo en streaming. */
async function hashFile(p) {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(p)) {
    md5.update(chunk);
    sha256.update(chunk);
    bytes += chunk.length;
  }
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex'), bytes };
}

/**
 * Ejecuta `fn` con hasta MAX_RETRIES reintentos y espera exponencial.
 * Los errores de red, tiempos de espera, HTTP 408/425/429/5xx y MD5
 * incorrectos se consideran transitorios; el resto falla de inmediato.
 */
async function withRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PermanentError || attempt >= MAX_RETRIES) {
        const suffix = attempt > 0 ? ` tras ${attempt + 1} intentos` : '';
        throw new Error(`${label}: ${describeError(err)}${suffix}`);
      }
      const delay = 1000 * 2 ** attempt;
      console.warn(`    reintento ${attempt + 1}/${MAX_RETRIES} de ${label} en ${delay / 1000} s: ${describeError(err)}`);
      await sleep(delay);
    }
  }
}

function throwForStatus(url, res) {
  if (res.ok) return;
  const err = new HttpError(url, res.status, res.statusText);
  const transient = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
  if (!transient) throw new PermanentError(err.message);
  throw err;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  throwForStatus(url, res);
  return res.json();
}

/**
 * Descarga `url` a `dest` calculando hashes en streaming. Escribe primero en
 * `dest.part` y solo renombra si el MD5 y el tamaño coinciden con la API.
 */
async function downloadFile(url, dest, expected) {
  const tmp = `${dest}.part`;
  const controller = new AbortController();
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new Error(`sin datos durante ${IDLE_TIMEOUT_MS / 1000} s`)),
      IDLE_TIMEOUT_MS,
    );
  };
  resetIdle();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    throwForStatus(url, res);
    if (!res.body) throw new Error(`respuesta sin cuerpo en ${url}`);

    const md5 = createHash('md5');
    const sha256 = createHash('sha256');
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      async function* hashChunks(source) {
        for await (const chunk of source) {
          md5.update(chunk);
          sha256.update(chunk);
          bytes += chunk.length;
          resetIdle();
          yield chunk;
        }
      },
      createWriteStream(tmp),
    );
    const digest = { md5: md5.digest('hex'), sha256: sha256.digest('hex'), bytes };
    if (digest.md5 !== expected.md5 || digest.bytes !== expected.size) {
      // Se trata como transitorio: una descarga corrupta suele resolverse reintentando.
      throw new Error(
        `integridad fallida (md5 ${digest.md5} / ${digest.bytes} B; esperado ${expected.md5} / ${expected.size} B)`,
      );
    }
    await fs.rename(tmp, dest);
    return digest;
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  } finally {
    clearTimeout(idleTimer);
  }
}

// ---------------------------------------------------------------------------
// Manifiesto, lock y argumentos
// ---------------------------------------------------------------------------

function validateManifest(manifest) {
  if (manifest?.version !== 1) throw new PermanentError('manifest.json: versión no soportada (se espera 1).');
  if (typeof manifest.outputDir !== 'string' || !manifest.outputDir) {
    throw new PermanentError('manifest.json: falta "outputDir".');
  }
  if (!Array.isArray(manifest.textures) || manifest.textures.length === 0) {
    throw new PermanentError('manifest.json: "textures" debe ser una lista no vacía.');
  }
  const seen = new Set();
  for (const tex of manifest.textures) {
    if (typeof tex.id !== 'string' || !/^[a-z0-9_]+$/.test(tex.id)) {
      throw new PermanentError(`manifest.json: id inválido ${JSON.stringify(tex.id)}.`);
    }
    if (seen.has(tex.id)) throw new PermanentError(`manifest.json: id duplicado ${tex.id}.`);
    seen.add(tex.id);
    if (tex.source !== 'polyhaven') {
      throw new PermanentError(`manifest.json: ${tex.id} tiene una fuente no soportada (${tex.source}).`);
    }
    if (typeof tex.role !== 'string' || !tex.role) throw new PermanentError(`manifest.json: ${tex.id} sin "role".`);
    if (resIndex(tex.maxResolution) < resIndex(MIN_RUNTIME_RESOLUTION)) {
      throw new PermanentError(`manifest.json: ${tex.id} tiene maxResolution inválida (${tex.maxResolution}).`);
    }
  }
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      verify: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  const only = values.only
    ? values.only
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  return { only, verify: values.verify, help: values.help };
}

function selectTextures(manifest, only) {
  if (!only) return manifest.textures;
  const known = new Set(manifest.textures.map((t) => t.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length) throw new PermanentError(`--only: ids que no están en el manifiesto: ${unknown.join(', ')}`);
  return manifest.textures.filter((t) => only.includes(t.id));
}

async function readLock() {
  if (!(await exists(LOCK_PATH))) return null;
  const lock = await readJson(LOCK_PATH);
  if (lock.lockfileVersion !== LOCK_VERSION) {
    throw new PermanentError(`manifest.lock.json: versión ${lock.lockfileVersion} no soportada.`);
  }
  return lock;
}

/** Resoluciones de ejecución para una resolución máxima, sin escalar hacia arriba. */
function runtimeResolutions(maxResolution) {
  return RESOLUTIONS.slice(resIndex(MIN_RUNTIME_RESOLUTION), resIndex(maxResolution) + 1);
}

// ---------------------------------------------------------------------------
// API de Poly Haven
// ---------------------------------------------------------------------------

/** Extrae y valida la entrada JPG de un mapa a una resolución dada. */
function pickJpg(files, id, mapKey, resolution) {
  const entry = files?.[mapKey]?.[resolution]?.jpg;
  if (!entry) {
    const available = Object.keys(files?.[mapKey] ?? {}).join(', ') || 'ninguna';
    throw new PermanentError(`${id}: el mapa ${mapKey} no tiene JPG a ${resolution} (disponibles: ${available}).`);
  }
  let url;
  try {
    url = new URL(entry.url);
  } catch {
    throw new PermanentError(`${id}: URL inválida para ${mapKey} ${resolution}.`);
  }
  const hostOk = ALLOWED_HOST_SUFFIXES.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
  if (url.protocol !== 'https:' || !hostOk) {
    throw new PermanentError(`${id}: URL no permitida para ${mapKey} ${resolution}: ${entry.url}`);
  }
  if (typeof entry.md5 !== 'string' || !/^[0-9a-f]{32}$/.test(entry.md5)) {
    throw new PermanentError(`${id}: MD5 inválido para ${mapKey} ${resolution}.`);
  }
  if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
    throw new PermanentError(`${id}: tamaño inválido para ${mapKey} ${resolution}.`);
  }
  return { map: mapKey, resolution, url: url.href, md5: entry.md5, size: entry.size };
}

function normalizeAuthors(authors) {
  if (!authors || typeof authors !== 'object') return [];
  return Object.entries(authors).map(([name, contribution]) => ({ name, contribution: String(contribution) }));
}

// ---------------------------------------------------------------------------
// Procesamiento de imágenes
// ---------------------------------------------------------------------------

/**
 * Construye un mapa ARM (R = oclusión, G = rugosidad, B = metalicidad) a
 * partir de mapas sueltos. Sin AO se usa blanco (sin oclusión); sin Metal,
 * negro (dieléctrico). Se exporta para poder probarlo de forma aislada.
 */
export async function buildArmFromChannels({ roughPath, aoPath = null, metalPath = null, outPath }) {
  const roughMeta = await sharp(roughPath).metadata();
  const { width, height } = roughMeta;

  const readChannel = async (p) => {
    const meta = await sharp(p).metadata();
    let img = sharp(p);
    if (meta.width !== width || meta.height !== height) {
      img = img.resize({ width, height, fit: 'fill', kernel: 'lanczos3' });
    }
    const { data } = await img.extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    return data;
  };

  const rough = await readChannel(roughPath);
  const ao = aoPath ? await readChannel(aoPath) : null;
  const metal = metalPath ? await readChannel(metalPath) : null;

  const pixels = width * height;
  const out = Buffer.alloc(pixels * 3);
  for (let i = 0, j = 0; i < pixels; i++, j += 3) {
    out[j] = ao ? ao[i] : 255;
    out[j + 1] = rough[i];
    out[j + 2] = metal ? metal[i] : 0;
  }
  const tmp = `${outPath}.tmp.jpg`;
  await sharp(out, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: GENERATED_ARM_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(tmp);
  await fs.rename(tmp, outPath);
  return { width, height };
}

function sameTransform(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Genera (o reutiliza si no cambió nada) una variante de ejecución. */
async function produceVariant({ sourcePath, sourceSha256, target, transform, previous }) {
  if (
    previous &&
    previous.sourceSha256 === sourceSha256 &&
    sameTransform(previous.transform, transform) &&
    (await exists(target))
  ) {
    const current = await hashFile(target);
    if (current.sha256 === previous.sha256 && current.bytes === previous.bytes) {
      return { ...current, reused: true };
    }
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp.jpg`;
  if (transform.method === 'copy') {
    await fs.copyFile(sourcePath, tmp);
  } else {
    await sharp(sourcePath)
      .resize({ width: transform.width, height: transform.height, fit: 'fill', kernel: transform.kernel })
      .jpeg({ quality: transform.quality, mozjpeg: true, chromaSubsampling: transform.chromaSubsampling })
      .toFile(tmp);
  }
  await fs.rename(tmp, target);
  return { ...(await hashFile(target)), reused: false };
}

// ---------------------------------------------------------------------------
// Proceso por textura
// ---------------------------------------------------------------------------

/** Asegura que un archivo fuente esté en caché con el MD5 de la API. */
async function ensureCached(spec, cachePath, previousFile, stats) {
  const label = `${spec.map} ${spec.resolution}`;
  if (await exists(cachePath)) {
    const digest = await hashFile(cachePath);
    if (digest.md5 === spec.md5 && digest.bytes === spec.size) {
      const downloadedAt =
        previousFile?.md5 === spec.md5 ? previousFile.downloadedAt : (await fs.stat(cachePath)).mtime.toISOString();
      stats.filesCached++;
      console.log(`    ${label}: en caché, md5 correcto (${mib(digest.bytes)})`);
      return { ...digest, downloadedAt };
    }
    console.log(`    ${label}: la caché no coincide con la API, se vuelve a descargar`);
  }
  const digest = await withRetry(`descarga ${spec.url}`, () => downloadFile(spec.url, cachePath, spec));
  stats.filesDownloaded++;
  stats.bytesDownloaded += digest.bytes;
  console.log(`    ${label}: descargado, md5 correcto (${mib(digest.bytes)})`);
  return { ...digest, downloadedAt: new Date().toISOString() };
}

async function processTexture(tex, previous, outputDir, stats) {
  const { id, maxResolution } = tex;
  console.log(`\n[${id}] rol ${tex.role}, resolución máxima ${maxResolution}`);

  const [files, info] = await Promise.all([
    withRetry(`API files/${id}`, () => fetchJson(`${API_BASE}/files/${encodeURIComponent(id)}`)),
    withRetry(`API info/${id}`, () => fetchJson(`${API_BASE}/info/${encodeURIComponent(id)}`)),
  ]);
  if (info?.type !== POLYHAVEN_TYPE_TEXTURE) {
    throw new PermanentError(`${id}: Poly Haven no lo clasifica como textura (type=${info?.type}).`);
  }

  // Mapas a descargar: albedo y normal siempre; ARM empaquetado o sus componentes.
  const hasArm = Boolean(files?.arm?.[maxResolution]?.jpg);
  const specs = [pickJpg(files, id, 'Diffuse', maxResolution), pickJpg(files, id, 'nor_gl', maxResolution)];
  let armFallback = null;
  if (hasArm) {
    specs.push(pickJpg(files, id, 'arm', maxResolution));
  } else {
    armFallback = {
      rough: pickJpg(files, id, ARM_FALLBACK.rough, maxResolution),
      ao: files?.[ARM_FALLBACK.ao]?.[maxResolution]?.jpg ? pickJpg(files, id, ARM_FALLBACK.ao, maxResolution) : null,
      metal: files?.[ARM_FALLBACK.metal]?.[maxResolution]?.jpg
        ? pickJpg(files, id, ARM_FALLBACK.metal, maxResolution)
        : null,
    };
    console.log(
      `    sin mapa "arm": se construirá desde ${ARM_FALLBACK.ao}${armFallback.ao ? '' : ' (ausente → blanco)'}, ` +
        `${ARM_FALLBACK.rough} y ${armFallback.metal ? ARM_FALLBACK.metal : 'metalicidad negra'}`,
    );
    specs.push(...[armFallback.ao, armFallback.rough, armFallback.metal].filter(Boolean));
  }

  // Descargas en paralelo dentro de la textura.
  const texCacheDir = path.join(CACHE_DIR, id);
  await fs.mkdir(texCacheDir, { recursive: true });
  const previousFiles = new Map((previous?.files ?? []).map((f) => [`${f.map}/${f.resolution}`, f]));
  const results = await Promise.allSettled(
    specs.map(async (spec) => {
      const cachePath = path.join(texCacheDir, `${spec.map}_${spec.resolution}.jpg`);
      const digest = await ensureCached(spec, cachePath, previousFiles.get(`${spec.map}/${spec.resolution}`), stats);
      return { spec, cachePath, digest };
    }),
  );
  const failures = results.filter((r) => r.status === 'rejected').map((r) => describeError(r.reason));
  if (failures.length) throw new Error(`${id}: fallaron ${failures.length} descargas:\n  - ${failures.join('\n  - ')}`);
  const cached = new Map(results.map((r) => [r.value.spec.map, r.value]));

  const lockFiles = results.map(({ value: { spec, cachePath, digest } }) => ({
    map: spec.map,
    resolution: spec.resolution,
    url: spec.url,
    md5: digest.md5,
    sha256: digest.sha256,
    bytes: digest.bytes,
    cachePath: relFromSim(cachePath),
    downloadedAt: digest.downloadedAt,
  }));

  // Fuente de cada mapa de ejecución (el ARM puede ser generado).
  const sources = new Map();
  sources.set('albedo', { path: cached.get('Diffuse').cachePath, sha256: cached.get('Diffuse').digest.sha256 });
  sources.set('normal', { path: cached.get('nor_gl').cachePath, sha256: cached.get('nor_gl').digest.sha256 });
  let derived = [];
  if (hasArm) {
    sources.set('arm', { path: cached.get('arm').cachePath, sha256: cached.get('arm').digest.sha256 });
  } else {
    const armPath = path.join(texCacheDir, `arm-generated_${maxResolution}.jpg`);
    const fromSha = Object.fromEntries(
      [armFallback.ao, armFallback.rough, armFallback.metal]
        .filter(Boolean)
        .map((s) => [s.map, cached.get(s.map).digest.sha256]),
    );
    const prevDerived = previous?.derived?.find((d) => d.map === 'arm' && d.resolution === maxResolution);
    let armDigest = null;
    if (prevDerived && sameTransform(prevDerived.fromSha256, fromSha) && (await exists(armPath))) {
      const current = await hashFile(armPath);
      if (current.sha256 === prevDerived.sha256) armDigest = current;
    }
    if (armDigest) {
      console.log(`    arm ${maxResolution}: generado previamente, reutilizado`);
    } else {
      await buildArmFromChannels({
        roughPath: cached.get(armFallback.rough.map).cachePath,
        aoPath: armFallback.ao ? cached.get(armFallback.ao.map).cachePath : null,
        metalPath: armFallback.metal ? cached.get(armFallback.metal.map).cachePath : null,
        outPath: armPath,
      });
      armDigest = await hashFile(armPath);
      console.log(`    arm ${maxResolution}: generado con sharp (${mib(armDigest.bytes)})`);
    }
    derived = [
      {
        map: 'arm',
        resolution: maxResolution,
        channels: {
          r: armFallback.ao ? ARM_FALLBACK.ao : 'constante 255',
          g: ARM_FALLBACK.rough,
          b: armFallback.metal ? ARM_FALLBACK.metal : 'constante 0',
        },
        fromSha256: fromSha,
        encoder: 'mozjpeg',
        quality: GENERATED_ARM_QUALITY,
        chromaSubsampling: '4:4:4',
        sha256: armDigest.sha256,
        bytes: armDigest.bytes,
        cachePath: relFromSim(armPath),
      },
    ];
    sources.set('arm', { path: armPath, sha256: armDigest.sha256 });
  }

  // Variantes de ejecución: copia exacta a resolución máxima, reducciones por debajo.
  const previousVariants = new Map((previous?.variants ?? []).map((v) => [`${v.map}/${v.resolution}`, v]));
  const resolutions = runtimeResolutions(maxResolution);
  const variants = [];
  let generated = 0;
  let reused = 0;
  for (const map of RUNTIME_MAPS) {
    const source = sources.get(map.name);
    const meta = await sharp(source.path).metadata();
    for (const res of resolutions) {
      const factor = 2 ** (resIndex(maxResolution) - resIndex(res));
      const transform =
        factor === 1
          ? { method: 'copy' }
          : {
              method: 'resize',
              from: maxResolution,
              width: Math.round(meta.width / factor),
              height: Math.round(meta.height / factor),
              kernel: 'lanczos3',
              encoder: 'mozjpeg',
              quality: map.quality,
              chromaSubsampling: map.chromaSubsampling,
            };
      const relPath = `${id}/${res}/${map.name}.jpg`;
      const result = await produceVariant({
        sourcePath: source.path,
        sourceSha256: source.sha256,
        target: resolveInside(outputDir, relPath),
        transform,
        previous: previousVariants.get(`${map.name}/${res}`),
      });
      if (result.reused) reused++;
      else generated++;
      variants.push({
        map: map.name,
        resolution: res,
        path: relPath,
        bytes: result.bytes,
        sha256: result.sha256,
        sourceSha256: source.sha256,
        transform,
      });
    }
  }
  stats.variantsGenerated += generated;
  stats.variantsReused += reused;
  console.log(`    variantes ${resolutions.join('/')}: ${generated} generadas, ${reused} reutilizadas`);

  // Elimina resoluciones que ya no corresponden (p. ej., si bajó maxResolution).
  for (const res of RESOLUTIONS) {
    if (!resolutions.includes(res)) await fs.rm(path.join(outputDir, id, res), { recursive: true, force: true });
  }

  const downloadedAt = lockFiles.map((f) => f.downloadedAt).sort().at(-1);
  return {
    id,
    role: tex.role,
    source: tex.source,
    title: info.name,
    authors: normalizeAuthors(info.authors),
    license: LICENSE,
    page: `https://polyhaven.com/a/${id}`,
    maxResolution,
    dimensionsMm: Array.isArray(info.dimensions) ? info.dimensions.map((v) => Math.round(v * 10) / 10) : null,
    polyhavenFilesHash: info.files_hash ?? null,
    downloadedAt,
    files: lockFiles,
    derived,
    variants,
  };
}

// ---------------------------------------------------------------------------
// Índice para la aplicación
// ---------------------------------------------------------------------------

function buildIndex(entries) {
  return {
    version: INDEX_VERSION,
    pathTemplate: '{id}/{resolution}/{map}.jpg',
    maps: [
      { name: 'albedo', colorSpace: 'srgb' },
      { name: 'normal', colorSpace: 'linear', convention: 'opengl' },
      { name: 'arm', colorSpace: 'linear', channels: { r: 'ao', g: 'roughness', b: 'metalness' } },
    ],
    textures: entries.map((e) => ({
      id: e.id,
      role: e.role,
      title: e.title,
      resolutions: RESOLUTIONS.filter((res) =>
        RUNTIME_MAPS.every((m) => e.variants.some((v) => v.map === m.name && v.resolution === res)),
      ),
      dimensionsMm: e.dimensionsMm,
    })),
  };
}

// ---------------------------------------------------------------------------
// Modos de ejecución
// ---------------------------------------------------------------------------

function printVariantTotals(entries) {
  const perRes = new Map();
  let total = 0;
  for (const e of entries) {
    for (const v of e.variants) {
      perRes.set(v.resolution, (perRes.get(v.resolution) ?? 0) + v.bytes);
      total += v.bytes;
    }
  }
  const detail = RESOLUTIONS.filter((r) => perRes.has(r))
    .map((r) => `${r}: ${mib(perRes.get(r))}`)
    .join(' · ');
  console.log(`  Variantes de ejecución en total: ${mib(total)} (${detail})`);
}

async function runFetch(manifest, selected, outputDir) {
  const lock = await readLock();
  const previousById = new Map((lock?.textures ?? []).map((t) => [t.id, t]));
  const stats = { filesDownloaded: 0, filesCached: 0, bytesDownloaded: 0, variantsGenerated: 0, variantsReused: 0 };

  const processed = new Map();
  for (const tex of selected) {
    processed.set(tex.id, await processTexture(tex, previousById.get(tex.id), outputDir, stats));
  }

  // Lock combinado: entradas nuevas + entradas previas de texturas no seleccionadas.
  const entries = [];
  for (const tex of manifest.textures) {
    const entry = processed.get(tex.id) ?? previousById.get(tex.id);
    if (entry) entries.push(entry);
    else console.warn(`AVISO: ${tex.id} no tiene entrada en el lock; ejecute sin --only para incluirla.`);
  }

  await writeJson(LOCK_PATH, {
    lockfileVersion: LOCK_VERSION,
    manifestVersion: manifest.version,
    generator: { script: 'scripts/fetch-assets.mjs', sharp: sharp.versions.sharp, vips: sharp.versions.vips },
    outputDir: manifest.outputDir,
    textures: entries,
  });
  const indexPath = path.join(outputDir, 'index.json');
  await writeJson(indexPath, buildIndex(entries));

  const cacheBytes = entries.reduce(
    (sum, e) => sum + e.files.reduce((s, f) => s + f.bytes, 0) + e.derived.reduce((s, d) => s + d.bytes, 0),
    0,
  );
  console.log('\nResumen');
  console.log(`  Texturas procesadas: ${processed.size} de ${manifest.textures.length}`);
  console.log(
    `  Archivos fuente: ${stats.filesDownloaded + stats.filesCached} ` +
      `(${stats.filesDownloaded} descargados, ${stats.filesCached} reutilizados de la caché)`,
  );
  console.log(`  Descargado en esta ejecución: ${mib(stats.bytesDownloaded)}`);
  console.log(`  Caché de fuentes (texturas del lock): ${mib(cacheBytes)}`);
  console.log(`  Variantes: ${stats.variantsGenerated} generadas, ${stats.variantsReused} reutilizadas`);
  printVariantTotals(entries);
  console.log(`  Lock: ${relFromSim(LOCK_PATH)}`);
  console.log(`  Índice: ${relFromSim(indexPath)}`);
}

/** Verifica caché y variantes contra el lock, sin acceso a red. */
async function runVerify(manifest, selected, outputDir) {
  const lock = await readLock();
  if (!lock) throw new PermanentError('No existe assets/manifest.lock.json; ejecute primero la descarga.');
  const lockById = new Map(lock.textures.map((t) => [t.id, t]));
  const problems = [];
  let checked = 0;

  const check = async (id, label, absPath, expected) => {
    checked++;
    if (!(await exists(absPath))) {
      problems.push(`${id}: falta ${label} (${relFromSim(absPath)})`);
      return;
    }
    const actual = await hashFile(absPath);
    const mismatches = ['md5', 'sha256', 'bytes'].filter((k) => k in expected && expected[k] !== actual[k]);
    if (mismatches.length) problems.push(`${id}: ${label} no coincide con el lock (${mismatches.join(', ')})`);
  };

  for (const tex of selected) {
    const entry = lockById.get(tex.id);
    if (!entry) {
      problems.push(`${tex.id}: no tiene entrada en el lock`);
      continue;
    }
    const before = problems.length;
    if (entry.role !== tex.role) problems.push(`${tex.id}: rol del lock (${entry.role}) ≠ manifiesto (${tex.role})`);
    if (entry.maxResolution !== tex.maxResolution) {
      problems.push(`${tex.id}: maxResolution del lock (${entry.maxResolution}) ≠ manifiesto (${tex.maxResolution})`);
    }
    for (const f of entry.files) {
      await check(tex.id, `fuente ${f.map} ${f.resolution}`, resolveInside(SIM_ROOT, f.cachePath), f);
    }
    for (const d of entry.derived ?? []) {
      await check(tex.id, `ARM generado ${d.resolution}`, resolveInside(SIM_ROOT, d.cachePath), d);
    }
    for (const res of runtimeResolutions(tex.maxResolution)) {
      for (const map of RUNTIME_MAPS) {
        const v = entry.variants.find((x) => x.map === map.name && x.resolution === res);
        if (!v) problems.push(`${tex.id}: el lock no registra la variante ${map.name} ${res}`);
        else await check(tex.id, `variante ${v.path}`, resolveInside(outputDir, v.path), v);
      }
    }
    const status = problems.length === before ? 'OK' : 'FALLO';
    console.log(`  ${status.padEnd(5)} ${tex.id} (${entry.files.length} fuentes, ${entry.variants.length} variantes)`);
  }

  const indexPath = path.join(outputDir, 'index.json');
  if (!(await exists(indexPath))) {
    problems.push(`falta ${relFromSim(indexPath)}`);
  } else {
    const index = await readJson(indexPath);
    const indexed = new Map((index.textures ?? []).map((t) => [t.id, t]));
    for (const tex of selected) {
      const expectedRes = runtimeResolutions(tex.maxResolution).join(',');
      const got = indexed.get(tex.id)?.resolutions?.join(',');
      if (got !== expectedRes) problems.push(`index.json: ${tex.id} lista [${got ?? '—'}], se esperaba [${expectedRes}]`);
    }
  }

  console.log(`\nVerificación: ${checked} archivos comprobados, ${problems.length} problemas`);
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}

async function main() {
  const { only, verify, help } = parseCli();
  if (help) {
    console.log('Uso: node scripts/fetch-assets.mjs [--only id1,id2] [--verify]');
    return;
  }
  const manifest = await readJson(MANIFEST_PATH);
  validateManifest(manifest);
  const outputDir = resolveInside(SIM_ROOT, manifest.outputDir);
  const selected = selectTextures(manifest, only);

  if (verify) {
    console.log(`Verificando ${selected.length} texturas contra ${relFromSim(LOCK_PATH)} (sin red)\n`);
    await runVerify(manifest, selected, outputDir);
  } else {
    console.log(`Procesando ${selected.length} texturas de ${relFromSim(MANIFEST_PATH)}`);
    await runFetch(manifest, selected, outputDir);
  }
}

// Solo se ejecuta como CLI; al importarlo (pruebas) expone buildArmFromChannels.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
const isCli =
  process.platform === 'win32' ? invokedPath.toLowerCase() === selfPath.toLowerCase() : invokedPath === selfPath;
if (isCli) {
  main().catch((err) => {
    console.error(`\nERROR: ${describeError(err)}`);
    process.exitCode = 1;
  });
}
