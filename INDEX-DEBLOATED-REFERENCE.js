import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

const TENANTS = {
  tn: { domain: 'topnepali.com', rateLimit: false },
  ginfo: { domain: 'grisma.info.np', rateLimit: false },
  gcom: { domain: 'grisma.com.np', rateLimit: false },
  gname: { domain: 'grisma.name.np', rateLimit: false },
  ecn: { domain: 'election.gov.np', rateLimit: false },
};

const LANDING_PAGE = 'https://imagengine.grisma.info.np';
const CONTACT_URL = 'https://grisma.info.np/contact';

const ENGINE_KEYS = new Set([
  'format', 'w', 'width', 'h', 'height', 'q', 'quality',
  'avatar', 'fit', 'position', 'blur', 'sharpen',
]);

const MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';
const CDN_CACHE = 'public, max-age=31536000, immutable';
const dailyUsage = new Map();

function rateLimitExceeded(tenantKey, limit = 1000) {
  const key = `${tenantKey}:${new Date().toISOString().slice(0, 10)}`;
  const count = dailyUsage.get(key) || 0;
  if (count >= limit) return true;
  dailyUsage.set(key, count + 1);
  return false;
}

function error(res, status, message) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  return res.status(status).json({ error: message, status });
}

function imageResponse(res, body, { type, filename, host, engine }) {
  res.setHeader('X-Render-Engine', engine);
  res.setHeader('X-Origin-Host', host);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', body.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', CACHE);
  res.setHeader('CDN-Cache-Control', CDN_CACHE);
  res.setHeader('Cloudflare-CDN-Cache-Control', CDN_CACHE);
  return res.status(200).send(body);
}

function normalizeExt(ext = '') {
  return ext.toLowerCase().replace('jpeg', 'jpg');
}

function resolveUpstream(cleanPath, query = {}) {
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const hostParts = parts[0].toLowerCase().split('.');
  const tenantKey = hostParts.pop();
  const tenant = TENANTS[tenantKey];
  if (!tenant) return null;

  const originHost = hostParts.length
    ? `${hostParts.join('.')}.${tenant.domain}`
    : tenant.domain;

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
    tenantKey,
    tenant,
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

  const width = query.w || query.width;
  const height = query.h || query.height;
  const rawQuality = query.q || query.quality;

  return {
    avatar,
    width: width ? parseInt(width, 10) : avatar ? 256 : null,
    height: height ? parseInt(height, 10) : avatar ? 256 : null,
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
    err.status = 404;
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

  if (source.raster && source.raster.length < 50) {
    const err = new Error('Invalid image buffer');
    err.status = 404;
    throw err;
  }

  let img = sharp(
    source.svg ? Buffer.from(source.svg) : source.raster,
    source.svg ? { density: 150 } : undefined,
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
    webp: () => img.webp({ quality: opts.quality }),
    jpg: () => img.jpeg({ quality: opts.quality }),
    avif: () => img.avif({ quality: opts.quality }),
    png: () => img.png(),
  }[ext] || (() => img.png());

  return {
    buffer: await encode().toBuffer(),
    type: MIME[ext] || 'image/png',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'ETag, Cache-Control, X-Render-Engine, X-Origin-Host',
  );

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query || {};
  const rawPath = req.headers['x-matched-path'] || req.url || '';
  const [pathname] = rawPath.split('?');
  const cleanPath = pathname.replace(/^\/+|\/+$/g, '');

  if (cleanPath === 'favicon.ico') return res.status(204).end();

  if (!cleanPath || cleanPath === 'api' || cleanPath === 'health' || query.health) {
    if (query.json || query.health || cleanPath === 'health') {
      return res.status(200).json({
        service: 'ImageEngine Edge CDN',
        status: 'active',
        version: '2.0.0',
        allowedTenants: Object.keys(TENANTS),
        documentation: LANDING_PAGE,
        contact: CONTACT_URL,
      });
    }
    return res.redirect(307, `${LANDING_PAGE}/`);
  }

  const route = resolveUpstream(cleanPath, query);
  if (!route) {
    return error(
      res,
      404,
      'Route not found or invalid format schema. Required: /{tenant}/[subdomain.tenant/]{path}-{origExt}.{targetExt}',
    );
  }

  const {
    originUrl,
    originHost,
    tenantKey,
    tenant,
    withoutExt,
    origExt,
    requestedExt: routeExt,
  } = route;

  if (tenant.rateLimit) {
    const limit = tenant.dailyLimit || 1000;
    if (rateLimitExceeded(tenantKey, limit)) {
      res.setHeader('Retry-After', '86400');
      return error(
        res,
        429,
        `Daily quota exceeded (${limit}/day). Contact ${CONTACT_URL} for unthrottled access.`,
      );
    }
  }

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
    return imageResponse(res, Buffer.from(source.svg), {
      type: 'image/svg+xml; charset=utf-8',
      filename: `${path.basename(withoutExt)}.svg`,
      host: originHost,
      engine: 'edge-passthrough',
    });
  }

  if (!transformed && source.raster && (sameExt || (requestedExt === 'webp' && webpSource))) {
    return imageResponse(res, source.raster, {
      type: MIME[requestedExt] || source.type || 'application/octet-stream',
      filename: `${path.basename(withoutExt)}.${requestedExt}`,
      host: originHost,
      engine: 'edge-passthrough',
    });
  }

  try {
    const result = await transform(source, query, opts, requestedExt);
    return imageResponse(res, result.buffer, {
      type: result.type,
      filename: `${path.basename(withoutExt) || 'asset'}.${requestedExt}`,
      host: originHost,
      engine: source.svg ? 'sharp-svg' : 'sharp-raster',
    });
  } catch (err) {
    return error(res, err.status || 500, err.message || 'Image transformation failed');
  }
}
