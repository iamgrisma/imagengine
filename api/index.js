import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

/**
 * Tenant Registry: Allowed domain mappings and rate-limiting policy
 * rateLimit: false provides unthrottled access
 */
const TENANTS = {
  tn:    { domain: 'topnepali.com',   rateLimit: false },
  ginfo: { domain: 'grisma.info.np',  rateLimit: false },
  gcom:  { domain: 'grisma.com.np',   rateLimit: false },
  gname: { domain: 'grisma.name.np',  rateLimit: false },
  ecn:   { domain: 'election.gov.np', rateLimit: false },
};

const LANDING_PAGE = 'https://imagengine.grisma.info.np';
const CONTACT_URL = 'https://grisma.info.np/contact';

// Sliding daily usage tracker for throttled tenants
const dailyUsage = new Map();
function isRateLimitExceeded(tenantKey, dailyLimit = 1000) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${tenantKey}:${day}`;
  const current = dailyUsage.get(key) || 0;
  if (current >= dailyLimit) return true;
  dailyUsage.set(key, current + 1);
  return false;
}

/**
 * Deterministic upstream resolver (Strict, Zero-Probing, Zero Trial-and-Hit)
 * Pattern 1 (Subdomain):   /{subdomain}.{tenant}/{path}-{origExt}.{targetExt}
 * Pattern 2 (Root Domain): /{tenant}/{path}-{origExt}.{targetExt}
 * Backward-compat:         /{tenant}/{subdomain}/{path}-{origExt}.{targetExt}
 */
function resolveUpstream(cleanPath, query = {}) {
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  let originHost = '';
  let assetWithFormats = '';
  let tenantKey = '';
  let tenant = null;

  const target = segments[0].toLowerCase();
  const lastDot = target.lastIndexOf('.');

  if (lastDot !== -1) {
    // New format: subdomain.tenant (e.g. 'result.ecn', 'election.tn', 'blog.seoapp.ginfo')
    const subdomain = target.slice(0, lastDot);
    tenantKey = target.slice(lastDot + 1);
    tenant = TENANTS[tenantKey];
    if (!tenant) return null;
    originHost = `${subdomain}.${tenant.domain}`;
    assetWithFormats = segments.slice(1).join('/');
  } else if (TENANTS[target]) {
    tenantKey = target;
    tenant = TENANTS[tenantKey];

    // Backward compatibility for legacy /ecn/result/... or /tn/election/...
    const sub = segments[1].toLowerCase();
    if (segments.length >= 3 && (sub === 'result' || sub === 'election')) {
      originHost = `${sub}.${tenant.domain}`;
      assetWithFormats = segments.slice(2).join('/');
    } else if (segments.length >= 3 && (sub === 'main' || sub === 'www' || sub === '@')) {
      originHost = tenant.domain;
      assetWithFormats = segments.slice(2).join('/');
    } else {
      // Main root domain (e.g. /tn/uploads/photo-jpg.webp or /tn/abc-jpg.webp)
      originHost = tenant.domain;
      assetWithFormats = segments.slice(1).join('/');
    }
  } else {
    return null;
  }

  // Exact parse: {basePath}-{origExt}.{targetExt} or {basePath}.{origExt}.{targetExt}
  const matchDash = assetWithFormats.match(/^(.*)-(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i);
  const matchDot = !matchDash && assetWithFormats.match(/^(.*)\.(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i);
  const match = matchDash || matchDot;

  // Strict: Must specify original extension explicitly. No trial-and-hit guessing.
  if (!match) return null;

  const basePath = match[1];
  const origExt = match[2].toLowerCase();
  const requestedExt = match[3].toLowerCase();

  // Forward non-transformation query parameters
  const forwardParams = new URLSearchParams();
  const engineKeys = new Set(['format', 'w', 'width', 'h', 'height', 'q', 'quality', 'avatar', 'fit', 'position', 'blur', 'sharpen']);
  for (const [k, v] of Object.entries(query)) {
    if (!engineKeys.has(k)) forwardParams.set(k, v);
  }
  const qs = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

  const originUrl = `https://${originHost}/${basePath}.${origExt}${qs}`;

  return {
    originUrl,
    originHost,
    tenantKey,
    tenant,
    withoutExt: basePath,
    requestedExt,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control, X-Render-Engine, X-Origin-Host');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query || {};
  const rawPath = req.headers['x-matched-path'] || req.url || '';
  const [pathname] = rawPath.split('?');
  const cleanPath = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  if (cleanPath === 'favicon.ico') return res.status(204).end();

  // Root landing redirect, health check, or diagnostic JSON
  if (cleanPath === '' || cleanPath === 'api' || cleanPath === 'health' || query.health) {
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

  function sendError(status, message) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    return res.status(status).json({ error: message, status });
  }

  const resolved = resolveUpstream(cleanPath, query);
  if (!resolved) {
    return sendError(404, 'Route not found or invalid format schema. Required: /{tenant}/[subdomain/]{path}-{origExt}.{targetExt}');
  }

  const { originUrl, originHost, tenantKey, tenant, withoutExt } = resolved;

  // Rate limiter check for throttled tenants
  if (tenant.rateLimit) {
    const limit = tenant.dailyLimit || 1000;
    if (isRateLimitExceeded(tenantKey, limit)) {
      res.setHeader('Retry-After', '86400');
      return sendError(429, `Daily quota exceeded (${limit}/day). Contact ${CONTACT_URL} for unthrottled access.`);
    }
  }

  // Fetch upstream asset: EXACTLY ONE HTTP request. ZERO trial-and-hit.
  let svgContent = '';
  let rasterBuffer = null;
  let sourceContentType = '';

  try {
    const upstream = await fetch(originUrl, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) {
      return sendError(404, `Upstream asset not found (${upstream.status})`);
    }
    sourceContentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isSvg = sourceContentType.includes('svg') || originUrl.includes('.svg');
    if (isSvg) {
      svgContent = await upstream.text();
    } else {
      const arrayBuf = await upstream.arrayBuffer();
      rasterBuffer = Buffer.from(arrayBuf);
    }
  } catch (err) {
    return sendError(502, `Upstream fetch error: ${err.message}`);
  }

  if (!svgContent && !rasterBuffer) {
    return sendError(404, 'Upstream asset payload empty');
  }

  // Output format determination
  const requestedExt = (query.format || resolved.requestedExt || 'webp').toLowerCase().replace('jpeg', 'jpg');

  // Transformation parameters (preserves 100% original dimensions unless explicitly requested)
  const isAvatar = query.avatar === '1' || query.avatar === 'true' || cleanPath.includes('/avatar/');
  const rawW = query.w || query.width;
  const rawH = query.h || query.height;
  const targetW = rawW ? parseInt(rawW, 10) : (isAvatar ? 256 : null);
  const targetH = rawH ? parseInt(rawH, 10) : (isAvatar ? 256 : null);

  const rawQ = query.q || query.quality;
  const quality = rawQ ? Math.min(Math.max(parseInt(rawQ, 10), 1), 100) : 85;

  const validFits = ['cover', 'contain', 'fill', 'inside', 'outside'];
  const fitMode = validFits.includes(query.fit) ? query.fit : 'cover';

  const validPositions = ['top', 'center', 'bottom', 'left', 'right', 'entropy', 'attention'];
  const cropPos = validPositions.includes(query.position) ? query.position : (isAvatar ? 'top' : 'center');

  // Fast direct pass-through for WebP sources when no dimensions or filters are altered
  const isWebpSource = sourceContentType.includes('webp') || originUrl.includes('.webp');
  const hasTransformModifications = targetW || targetH || isAvatar || query.q || query.quality || query.blur || query.sharpen;
  if (rasterBuffer && !svgContent && requestedExt === 'webp' && isWebpSource && !hasTransformModifications) {
    res.setHeader('X-Render-Engine', 'edge-passthrough');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', rasterBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(withoutExt)}.webp"`);
    res.setHeader('X-Origin-Host', originHost);
    return res.status(200).send(rasterBuffer);
  }

  // Transformation pipeline with Sharp
  try {
    let outputBuffer;
    let contentType = 'image/webp';

    if (svgContent) {
      if (!svgContent.includes('<svg')) return sendError(404, 'Invalid SVG payload');
      if (svgContent.length > 500000) return sendError(413, 'SVG exceeds 500KB limit');

      res.setHeader('X-Render-Engine', 'sharp-svg');
      let pipeline = sharp(Buffer.from(svgContent), { density: 150 });

      if (targetW && targetH) {
        pipeline = pipeline.resize(targetW, targetH, { fit: fitMode, position: cropPos });
      } else if (targetW || targetH) {
        pipeline = pipeline.resize(targetW || null, targetH || null);
      }

      if (query.blur) pipeline = pipeline.blur(Math.min(Math.max(parseFloat(query.blur), 0.3), 1000));
      if (query.sharpen === 'true' || query.sharpen === '1') pipeline = pipeline.sharpen();

      if (requestedExt === 'webp') {
        outputBuffer = await pipeline.webp({ quality }).toBuffer();
        contentType = 'image/webp';
      } else if (requestedExt === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality }).toBuffer();
        contentType = 'image/jpeg';
      } else if (requestedExt === 'avif') {
        outputBuffer = await pipeline.avif({ quality }).toBuffer();
        contentType = 'image/avif';
      } else {
        outputBuffer = await pipeline.png().toBuffer();
        contentType = 'image/png';
      }
    } else if (rasterBuffer) {
      if (rasterBuffer.length < 50) return sendError(404, 'Invalid image buffer');

      res.setHeader('X-Render-Engine', 'sharp-raster');
      let pipeline = sharp(rasterBuffer);

      if (targetW && targetH) {
        pipeline = pipeline.resize(targetW, targetH, {
          fit: fitMode,
          position: isAvatar ? 'top' : cropPos,
        });
      } else if (targetW || targetH) {
        pipeline = pipeline.resize(targetW || null, targetH || null, { fit: fitMode });
      }

      if (query.blur) pipeline = pipeline.blur(Math.min(Math.max(parseFloat(query.blur), 0.3), 1000));
      if (query.sharpen === 'true' || query.sharpen === '1') pipeline = pipeline.sharpen();

      if (requestedExt === 'webp') {
        outputBuffer = await pipeline.webp({ quality }).toBuffer();
        contentType = 'image/webp';
      } else if (requestedExt === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality }).toBuffer();
        contentType = 'image/jpeg';
      } else if (requestedExt === 'avif') {
        outputBuffer = await pipeline.avif({ quality }).toBuffer();
        contentType = 'image/avif';
      } else {
        outputBuffer = await pipeline.png().toBuffer();
        contentType = 'image/png';
      }
    }

    const filename = `${path.basename(withoutExt) || 'asset'}.${requestedExt}`;

    res.setHeader('X-Origin-Host', originHost);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    return res.status(200).send(outputBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Image transformation failed', status: 500 });
  }
}
