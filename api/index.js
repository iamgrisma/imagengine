import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

/**
 * Multi-Tenant Registry
 * Single clean configuration for all allowed domains, rate limits, and asset defaults.
 */
const TENANTS = {
  tn: {
    domain: 'topnepali.com',
    rateLimit: false,
    defaultExt: 'svg',
    defaultSub: 'election',
  },
  ecn: {
    domain: 'election.gov.np',
    rateLimit: false,
    defaultExt: 'jpg',
    defaultSub: 'result',
    isAvatar: true,
  },
  tnnp: {
    domain: 'topnepali.com.np',
    rateLimit: false,
    defaultExt: 'svg',
    defaultSub: 'main',
  },
};

/**
 * Validate that an upstream URL belongs to an allowed registered tenant domain
 */
function isAllowedDomain(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return Object.values(TENANTS).some(t => host === t.domain || host.endsWith('.' + t.domain));
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
 * Resolves request path to origin target URL dynamically
 */
function resolveUpstream(cleanPath, query) {
  const segments = cleanPath.split('/').filter(Boolean);
  const tenantKey = (segments[0] || '').toLowerCase();
  const tenant = TENANTS[tenantKey];

  if (!tenant) {
    // Backward compatibility fallback for legacy un-namespaced requests
    const legacySlug = cleanPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');
    if (!legacySlug || legacySlug === 'api') return null;
    const pathSlug = legacySlug.startsWith('og/') ? legacySlug : `og/${legacySlug}`;
    return {
      targetUrl: `https://${TENANTS.tn.defaultSub}.${TENANTS.tn.domain}/${pathSlug}.svg`,
      originHost: `${TENANTS.tn.defaultSub}.${TENANTS.tn.domain}`,
      tenantKey: 'tn',
      tenantConfig: TENANTS.tn,
      isAvatar: false,
    };
  }

  const sub = (segments[1] || '').toLowerCase();
  const originHost = (!sub || sub === 'main' || sub === 'www' || sub === '@')
    ? tenant.domain
    : `${sub}.${tenant.domain}`;

  const restSegments = segments.slice(2);
  let assetPath = restSegments.join('/');

  // ECN candidate photo shortcut: candidate/335208 -> Images/Candidate/335208.jpg
  if (tenantKey === 'ecn' && assetPath.toLowerCase().startsWith('candidate/')) {
    const id = assetPath.split('/')[1] || '';
    assetPath = `Images/Candidate/${id}.jpg`;
  }

  // Determine target extension
  const hasExt = assetPath.match(/\.(jpe?g|png|webp|gif|svg)$/i);
  if (!hasExt) {
    if (tenant.defaultExt === 'svg' || assetPath.startsWith('og/')) {
      assetPath = assetPath.startsWith('og/') ? `${assetPath}.svg` : `og/${assetPath}.svg`;
    } else {
      assetPath = `${assetPath}.${tenant.defaultExt || 'jpg'}`;
    }
  }

  // Forward custom query parameters (e.g. year=2079, locale=ne)
  const forwardParams = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (!['url', 'format', 'w', 'h', 'avatar', 'engine'].includes(k)) {
      forwardParams.set(k, v);
    }
  }
  const qs = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

  return {
    targetUrl: `https://${originHost}/${assetPath}${qs}`,
    originHost,
    tenantKey,
    tenantConfig: tenant,
    isAvatar: tenant.isAvatar || false,
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

  // Root or health inspection
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
    // Clean redirect to documentation portal
    return res.redirect(307, 'https://imagengine.grisma.info.np/');
  }

  function sendError(status, message) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(status).json({ error: message, status });
  }

  // Detect requested output format (.webp by default)
  const extMatch = cleanPath.match(/\.(webp|png|jpe?g)$/i);
  const requestedExt = (extMatch ? extMatch[1] : (query.format || 'webp')).toLowerCase().replace('jpeg', 'jpg');
  const pathWithoutExt = cleanPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');

  let targetUrl = query.url;
  let originHost = '';
  let isAvatarMode = false;
  let tenantKey = '';

  if (targetUrl) {
    // Explicit upstream URL passed via ?url=
    if (!isAllowedDomain(targetUrl)) {
      return sendError(403, 'Forbidden: Upstream domain not registered. Apply at https://grisma.info.np/contact');
    }
  } else {
    // Dynamic namespaced path resolution
    const resolved = resolveUpstream(cleanPath, query);
    if (!resolved) {
      return sendError(404, 'Image route not found or unknown tenant namespace');
    }
    targetUrl = resolved.targetUrl;
    originHost = resolved.originHost;
    tenantKey = resolved.tenantKey;
    isAvatarMode = resolved.isAvatar;

    // Tenant rate limiting
    if (resolved.tenantConfig.rateLimit) {
      const limit = resolved.tenantConfig.dailyLimit || 1000;
      if (isRateLimitExceeded(tenantKey, limit)) {
        res.setHeader('Retry-After', '86400');
        return sendError(429, `Daily transformation quota exceeded (${limit}/day). Request higher limits at https://grisma.info.np/contact`);
      }
    }
  }

  // Fetch upstream asset
  let svgContent = '';
  let rasterBuffer = null;

  try {
    const upstream = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) {
      return sendError(upstream.status || 404, `Upstream origin returned HTTP ${upstream.status}`);
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isSvg = contentType.includes('svg') || targetUrl.includes('.svg');

    if (isSvg) {
      svgContent = await upstream.text();
    } else {
      const arrayBuf = await upstream.arrayBuffer();
      rasterBuffer = Buffer.from(arrayBuf);
    }
  } catch (err) {
    return sendError(502, `Failed to fetch upstream asset: ${err.message}`);
  }

  // Transform with Sharp
  try {
    let outputBuffer;
    let contentType = 'image/webp';

    if (svgContent) {
      if (!svgContent.includes('<svg')) return sendError(404, 'Invalid SVG payload');
      if (svgContent.length > 500000) return sendError(413, 'SVG exceeds 500KB limit');

      res.setHeader('X-Render-Engine', 'sharp-svg');
      const pipeline = sharp(Buffer.from(svgContent), { density: 150 }).resize(1200);

      if (requestedExt === 'webp') {
        outputBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
        contentType = 'image/webp';
      } else if (requestedExt === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
        contentType = 'image/jpeg';
      } else {
        outputBuffer = await pipeline.png().toBuffer();
        contentType = 'image/png';
      }
    } else if (rasterBuffer) {
      if (rasterBuffer.length < 50) return sendError(404, 'Invalid image buffer');

      res.setHeader('X-Render-Engine', 'sharp-raster');
      let pipeline = sharp(rasterBuffer);

      const isAvatar = isAvatarMode || query.avatar === '1' || query.avatar === 'true';
      const targetW = query.w ? parseInt(query.w, 10) : (isAvatar ? 256 : null);
      const targetH = query.h ? parseInt(query.h, 10) : (isAvatar ? 256 : null);

      if (targetW && targetH) {
        pipeline = pipeline.resize(targetW, targetH, {
          fit: 'cover',
          position: isAvatar ? 'top' : 'center',
        });
      } else if (targetW) {
        pipeline = pipeline.resize(targetW);
      }

      if (requestedExt === 'webp') {
        outputBuffer = await pipeline.webp({ quality: 82 }).toBuffer();
        contentType = 'image/webp';
      } else if (requestedExt === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
        contentType = 'image/jpeg';
      } else {
        outputBuffer = await pipeline.png().toBuffer();
        contentType = 'image/png';
      }
    } else {
      return sendError(404, 'No asset content available');
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
