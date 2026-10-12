import sharp from 'sharp';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

// Restrict libvips to single-threaded processing and disable heap cache for serverless efficiency
sharp.concurrency(1);
sharp.cache(false);

const TENANTS = {
  tn: 'topnepali.com',
  ginfo: 'grisma.info.np',
  gcom: 'grisma.com.np',
  gname: 'grisma.name.np',
  ecn: 'election.gov.np',
};

const ENGINE_KEYS = new Set([
  'format', 'w', 'width', 'h', 'height', 'q', 'quality',
  'avatar', 'fit', 'position', 'blur', 'sharpen',
]);

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml; charset=utf-8',
};

const CACHE_HEADER = 'public, max-age=31536000, s-maxage=31536000, immutable';
const CDN_CACHE_HEADER = 'public, max-age=31536000, immutable';

function error(res, status, message) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res.status(status).json({ error: message, status });
}

function imageResponse(req, res, body, { type, filename, host, engine }) {
  const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('X-Render-Engine', engine);
  res.setHeader('X-Origin-Host', host);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', CACHE_HEADER);
  res.setHeader('CDN-Cache-Control', CDN_CACHE_HEADER);
  res.setHeader('Vercel-CDN-Cache-Control', CDN_CACHE_HEADER);
  res.setHeader('Cloudflare-CDN-Cache-Control', CDN_CACHE_HEADER);

  if (req && req.headers && req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  return res.status(200).send(body);
}

function normalizeExt(ext = '') {
  return ext.toLowerCase().replace('jpeg', 'jpg');
}

function resolveUpstream(cleanPath, query = {}) {
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const hostParts = parts[0].toLowerCase().split('.').filter(Boolean);
  if (!hostParts.length) return null;

  const tenantKey = hostParts.pop();
  const tenantDomain = TENANTS[tenantKey];
  if (!tenantDomain) return null;

  const originHost = hostParts.length
    ? `${hostParts.join('.')}.${tenantDomain}`
    : tenantDomain;

  const asset = parts.slice(1).join('/');

  const match =
    asset.match(/^(.*)-(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i) ||
    asset.match(/^(.*)\.(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i);

  if (!match) return null;

  const [, basePath, originalExt, targetExt] = match;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (!ENGINE_KEYS.has(key)) params.set(key, value);
  }

  const qs = params.toString() ? `?${params}` : '';

  return {
    originUrl: `https://${originHost}/${basePath}.${originalExt}${qs}`,
    originHost,
    withoutExt: basePath,
    origExt: normalizeExt(originalExt),
    requestedExt: normalizeExt(targetExt),
  };
}

function getOptions(query, cleanPath) {
  const avatar =
    query.avatar === '1' ||
    query.avatar === 'true' ||
    cleanPath.includes('/avatar/');

  const isOg =
    cleanPath.includes('/og/') ||
    cleanPath.endsWith('/og') ||
    /(?:^|\/)og(?:-|\.|$)/i.test(cleanPath);

  const width = query.w || query.width;
  const height = query.h || query.height;
  const rawQuality = query.q || query.quality;

  return {
    avatar,
    isOg,
    width: width ? parseInt(width, 10) : avatar ? 256 : isOg ? 1200 : null,
    height: height ? parseInt(height, 10) : avatar ? 256 : isOg ? 630 : null,
    quality: rawQuality
      ? Math.min(Math.max(parseInt(rawQuality, 10), 1), 100)
      : 85,
    fit: ['cover', 'contain', 'fill', 'inside', 'outside'].includes(query.fit)
      ? query.fit
      : 'cover',
    position: [
      'top', 'center', 'bottom', 'left', 'right', 'entropy', 'attention',
    ].includes(query.position)
      ? query.position
      : avatar ? 'top' : 'center',
  };
}

function needsTransform(query, opts) {
  return Boolean(
    opts.width ||
    opts.height ||
    opts.avatar ||
    opts.isOg ||
    query.q ||
    query.quality ||
    query.blur ||
    query.sharpen,
  );
}

async function fetchSource(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const err = new Error(`Upstream asset not found (${response.status})`);
    err.status = response.status;
    throw err;
  }

  const type = (response.headers.get('content-type') || '').toLowerCase();
  const svg = type.includes('svg') || url.includes('.svg');

  return {
    type,
    svg: svg ? await response.text() : '',
    raster: svg ? null : Buffer.from(await response.arrayBuffer()),
  };
}

async function transform(source, query, opts, ext) {
  if (source.svg) {
    if (!source.svg.includes('<svg')) {
      const err = new Error('Invalid SVG payload');
      err.status = 404;
      throw err;
    }
    if (source.svg.length > 2_000_000) {
      const err = new Error('SVG exceeds 2MB limit');
      err.status = 413;
      throw err;
    }
  }

  let inputBuffer = source.raster;
  if (source.svg) {
    const cleanSvg = source.svg
      .replace(/&[a-zA-Z0-9#]*…/g, '…')
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;');
    inputBuffer = Buffer.from(cleanSvg);
  }

  const targetWidth = opts.width || 1200;
  const svgDensity = (source.svg && targetWidth > 1200)
    ? Math.min(Math.round((targetWidth / 1200) * 72), 150)
    : 72;

  let img = sharp(
    inputBuffer,
    source.svg ? { density: svgDensity } : undefined,
  );

  if (opts.width && opts.height) {
    img = img.resize(opts.width, opts.height, {
      fit: opts.fit,
      position: opts.avatar ? 'top' : opts.position,
    });
  } else if (opts.width || opts.height) {
    img = img.resize(opts.width || null, opts.height || null);
  }

  if (query.blur) {
    img = img.blur(Math.min(Math.max(parseFloat(query.blur), 0.3), 1000));
  }

  if (query.sharpen === 'true' || query.sharpen === '1') {
    img = img.sharpen();
  }

  const encode = {
    webp: () => img.webp({ quality: opts.quality, effort: 2 }),
    jpg: () => img.jpeg({ quality: opts.quality, mozjpeg: false }),
    avif: () => img.avif({ quality: opts.quality, effort: 2 }),
    png: () => img.png({ compressionLevel: 6, effort: 4 }),
  }[ext] || (() => img.png({ compressionLevel: 6, effort: 4 }));

  return {
    buffer: await encode().toBuffer(),
    type: MIME[ext] || 'image/png',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control, X-Render-Engine, X-Origin-Host');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const query = req.query || {};
    const rawPath = req.headers['x-matched-path'] || req.url || '';
    const [pathname] = rawPath.split('?');
    const cleanPath = pathname.replace(/^\/+|\/+$/g, '');

    if (cleanPath === 'favicon.ico') return res.status(204).end();

    if (!cleanPath || cleanPath === 'api' || cleanPath === 'health') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({ status: 'ok', service: 'imagengine' });
    }

    const route = resolveUpstream(cleanPath, query);
    if (!route) {
      return error(
        res,
        404,
        'Route not found or invalid format schema. Required: /[subdomain.]identifier/{path}-{origExt}.{targetExt}',
      );
    }

    const {
      originUrl,
      originHost,
      withoutExt,
      origExt,
      requestedExt: routeExt,
    } = route;

    const requestedExt = normalizeExt(query.format || routeExt || 'webp');

    let source;
    try {
      source = await fetchSource(originUrl);
    } catch (err) {
      return error(
        res,
        err.status || 502,
        err.status ? err.message : `Upstream fetch error: ${err.message}`,
      );
    }

    if (!source.svg && !source.raster) {
      return error(res, 404, 'Upstream asset payload empty');
    }

    const opts = getOptions(query, cleanPath);
    const transformed = needsTransform(query, opts);
    const sameExt = origExt === requestedExt;
    const webpSource = source.type.includes('webp');

    if (!transformed && source.svg && requestedExt === 'svg') {
      return imageResponse(req, res, Buffer.from(source.svg), {
        type: MIME.svg,
        filename: `${path.basename(withoutExt)}.svg`,
        host: originHost,
        engine: 'edge-passthrough',
      });
    }

    if (!transformed && source.raster && (sameExt || (requestedExt === 'webp' && webpSource))) {
      return imageResponse(req, res, source.raster, {
        type: MIME[requestedExt] || source.type || 'application/octet-stream',
        filename: `${path.basename(withoutExt)}.${requestedExt}`,
        host: originHost,
        engine: 'edge-passthrough',
      });
    }

    const result = await transform(source, query, opts, requestedExt);
    return imageResponse(req, res, result.buffer, {
      type: result.type,
      filename: `${path.basename(withoutExt) || 'asset'}.${requestedExt}`,
      host: originHost,
      engine: source.svg ? 'sharp-svg' : 'sharp-raster',
    });
  } catch (err) {
    return error(res, err.status || 500, err.message || 'Image processing failed');
  }
}
