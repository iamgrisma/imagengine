import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

/**
 * Multi-Tenant Allowed Registry
 * Explicitly unthrottled for grisma.info.np, topnepali.com, grisma.com.np, and election.gov.np
 */
const TENANTS = {
  tn: { domain: 'topnepali.com', rateLimit: false },
  ginfo: { domain: 'grisma.info.np', rateLimit: false },
  gcom: { domain: 'grisma.com.np', rateLimit: false },
  gname: { domain: 'grisma.name.np', rateLimit: false },
  ecn: { domain: 'election.gov.np', rateLimit: false },
};

function getTenant(key) {
  if (!key) return null;
  const t = TENANTS[key.toLowerCase()];
  if (!t) return null;
  return typeof t === 'string' ? { domain: t, rateLimit: false } : t;
}

function isAllowedDomain(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return Object.keys(TENANTS).some(key => {
      const conf = getTenant(key);
      return conf && (host === conf.domain || host.endsWith('.' + conf.domain));
    });
  } catch {
    return false;
  }
}

/**
 * In-memory sliding window rate limiter
 */
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
 * Generates candidate upstream URLs to fetch from origin
 * Supports SVG, JPG, PNG, GIF, and WebP with zero forced conversions
 */
function getUpstreamCandidates(cleanPath, query) {
  const segments = cleanPath.split('/').filter(Boolean);
  const tenantKey = (segments[0] || '').toLowerCase();
  const tenant = getTenant(tenantKey);

  if (!tenant) {
    // Backward compatibility fallback for legacy un-namespaced requests
    const legacySlug = cleanPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');
    if (!legacySlug || legacySlug === 'api') return null;
    const pathSlug = legacySlug.startsWith('og/') ? legacySlug : `og/${legacySlug}`;
    return {
      candidates: [`https://election.topnepali.com/${pathSlug}.svg`],
      originHost: 'election.topnepali.com',
      tenantKey: 'tn',
      tenantConfig: { domain: 'topnepali.com', rateLimit: false },
    };
  }

  const sub = (segments[1] || '').toLowerCase();
  const originHost = (!sub || sub === 'main' || sub === 'www' || sub === '@')
    ? tenant.domain
    : `${sub}.${tenant.domain}`;

  const restSegments = segments.slice(2);
  let assetPath = restSegments.join('/');

  // Special shortcut: ECN candidate/335208 -> Images/Candidate/335208.jpg
  if (tenantKey === 'ecn' && assetPath.toLowerCase().startsWith('candidate/')) {
    const id = assetPath.split('/')[1].replace(/\.(webp|jpe?g|png)$/i, '');
    return {
      candidates: [`https://${originHost}/Images/Candidate/${id}.jpg`],
      originHost,
      tenantKey,
      tenantConfig: tenant,
    };
  }

  // If path starts with og/
  if (assetPath.startsWith('og/')) {
    const clean = assetPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');
    return {
      candidates: [`https://${originHost}/${clean}.svg`],
      originHost,
      tenantKey,
      tenantConfig: tenant,
    };
  }

  // If assetPath has an explicit file extension
  const extMatch = assetPath.match(/\.(jpe?g|png|webp|gif|svg)$/i);
  let candidates = [];
  if (extMatch) {
    const withoutExt = assetPath.replace(/\.(jpe?g|png|webp|gif|svg)$/i, '');
    const currentExt = extMatch[1].toLowerCase();
    if (currentExt === 'webp') {
      // Could be origin WebP, or origin JPG/PNG/SVG requested as WebP
      candidates = [
        `https://${originHost}/${assetPath}`,
        `https://${originHost}/${withoutExt}.jpg`,
        `https://${originHost}/${withoutExt}.jpeg`,
        `https://${originHost}/${withoutExt}.png`,
        `https://${originHost}/${withoutExt}.svg`,
      ];
    } else {
      candidates = [`https://${originHost}/${assetPath}`];
    }
  } else {
    // No extension specified: try webp, jpg, png, svg
    candidates = [
      `https://${originHost}/${assetPath}.webp`,
      `https://${originHost}/${assetPath}.jpg`,
      `https://${originHost}/${assetPath}.png`,
      `https://${originHost}/${assetPath}.svg`,
    ];
  }

  // Forward extra query parameters
  const forwardParams = new URLSearchParams();
  const knownEngineKeys = ['url', 'format', 'w', 'width', 'h', 'height', 'q', 'quality', 'avatar', 'engine', 'fit', 'position', 'blur', 'sharpen'];
  for (const [k, v] of Object.entries(query)) {
    if (!knownEngineKeys.includes(k)) {
      forwardParams.set(k, v);
    }
  }
  const qs = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

  return {
    candidates: candidates.map(u => `${u}${qs}`),
    originHost,
    tenantKey,
    tenantConfig: tenant,
  };
}

export default async function handler(req, res) {
  // CORS Headers
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

  // Root, health, or JSON inspection
  if (req.method === 'GET' && !query.url && (cleanPath === '' || cleanPath === 'api' || cleanPath === 'health' || query.health)) {
    if (query.json || query.health || cleanPath === 'health') {
      return res.status(200).json({
        service: 'ImageEngine Edge CDN',
        status: 'active',
        version: '2.0.0',
        allowedTenants: Object.keys(TENANTS),
        documentation: 'https://imagengine.grisma.info.np',
        endpoints: ['https://img.grisma.info.np', 'https://img.topnepali.com'],
        contact: 'https://grisma.info.np/contact'
      });
    }
    // Clean edge redirect to documentation portal
    return res.redirect(307, 'https://imagengine.grisma.info.np/');
  }

  function sendError(status, message) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(status).json({ error: message, status });
  }

  // Detect requested output format (.webp by default)
  const extMatch = cleanPath.match(/\.(webp|png|jpe?g|avif)$/i);
  const requestedExt = (extMatch ? extMatch[1] : (query.format || 'webp')).toLowerCase().replace('jpeg', 'jpg');
  const pathWithoutExt = cleanPath.replace(/\.(webp|png|jpe?g|svg|avif)$/i, '');

  let candidateUrls = [];
  let originHost = '';
  let tenantKey = '';

  if (query.url) {
    if (!isAllowedDomain(query.url)) {
      return sendError(403, 'Forbidden: Upstream domain not registered. Apply at https://grisma.info.np/contact');
    }
    candidateUrls = [query.url];
    try { originHost = new URL(query.url).hostname; } catch { }
  } else {
    const resolved = getUpstreamCandidates(cleanPath, query);
    if (!resolved || !resolved.candidates.length) {
      return sendError(404, 'Image route not found or unknown tenant namespace');
    }
    candidateUrls = resolved.candidates;
    originHost = resolved.originHost;
    tenantKey = resolved.tenantKey;

    if (resolved.tenantConfig.rateLimit) {
      const limit = resolved.tenantConfig.dailyLimit || 1000;
      if (isRateLimitExceeded(tenantKey, limit)) {
        res.setHeader('Retry-After', '86400');
        return sendError(429, `Daily transformation quota exceeded (${limit}/day). Request higher limits at https://grisma.info.np/contact`);
      }
    }
  }

  // Fetch upstream asset across candidates (fast sequential check)
  let svgContent = '';
  let rasterBuffer = null;
  let sourceContentType = '';
  let finalTargetUrl = '';

  for (const targetUrl of candidateUrls) {
    try {
      const upstream = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
      if (upstream.ok) {
        finalTargetUrl = targetUrl;
        sourceContentType = (upstream.headers.get('content-type') || '').toLowerCase();
        const isSvg = sourceContentType.includes('svg') || targetUrl.includes('.svg');
        if (isSvg) {
          svgContent = await upstream.text();
        } else {
          const arrayBuf = await upstream.arrayBuffer();
          rasterBuffer = Buffer.from(arrayBuf);
        }
        break;
      }
    } catch { }
  }

  if (!svgContent && !rasterBuffer) {
    return sendError(404, 'Upstream asset not found');
  }

  // Parse Transformation Parameters (Clean & Dimension-Preserving)
  const isAvatar = query.avatar === '1' || query.avatar === 'true' || cleanPath.includes('/avatar/');
  const rawW = query.w || query.width;
  const rawH = query.h || query.height;
  const targetW = rawW ? parseInt(rawW, 10) : (isAvatar ? 256 : null);
  const targetH = rawH ? parseInt(rawH, 10) : (isAvatar ? 256 : null);

  const rawQ = query.q || query.quality;
  const quality = rawQ ? Math.min(Math.max(parseInt(rawQ, 10), 1), 100) : (requestedExt === 'webp' ? 85 : 85);

  const validFits = ['cover', 'contain', 'fill', 'inside', 'outside'];
  const fitMode = validFits.includes(query.fit) ? query.fit : 'cover';

  const validPositions = ['top', 'center', 'bottom', 'left', 'right', 'entropy', 'attention'];
  const cropPos = validPositions.includes(query.position) ? query.position : (isAvatar ? 'top' : 'center');

  // Fast direct pass-through for existing WebP files when NO dimensions or filters are altered
  const isWebpSource = sourceContentType.includes('webp') || finalTargetUrl.endsWith('.webp');
  const hasTransformModifications = targetW || targetH || isAvatar || query.q || query.quality || query.blur || query.sharpen;
  if (rasterBuffer && !svgContent && requestedExt === 'webp' && isWebpSource && !hasTransformModifications) {
    res.setHeader('X-Render-Engine', 'edge-passthrough');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', rasterBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(pathWithoutExt)}.webp"`);
    if (originHost) res.setHeader('X-Origin-Host', originHost);
    return res.status(200).send(rasterBuffer);
  }

  // Image transformation via Sharp
  try {
    let outputBuffer;
    let contentType = 'image/webp';

    if (svgContent) {
      if (!svgContent.includes('<svg')) return sendError(404, 'Invalid SVG payload');
      if (svgContent.length > 500000) return sendError(413, 'SVG exceeds 500KB limit');

      res.setHeader('X-Render-Engine', 'sharp-svg');
      let pipeline = sharp(Buffer.from(svgContent), { density: 150 });

      // Preserve exact original dimensions unless width/height is explicitly requested
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

      // Preserve exact original dimensions unless width/height is explicitly requested
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

    const filename = `${pathWithoutExt ? path.basename(pathWithoutExt) : 'asset'}.${requestedExt}`;

    if (originHost) res.setHeader('X-Origin-Host', originHost);
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
