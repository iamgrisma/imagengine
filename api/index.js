import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

/**
 * Allowed Tenant Registry: Whitelist mapping {identifier} -> root domain
 * Universal: Engine-host agnostic, no host-header guessing, no special treatment
 */
const TENANTS = {
  tn:    'topnepali.com',
  ecn:   'election.gov.np',
  ginfo: 'grisma.info.np',
  gcom:  'grisma.com.np',
  gname: 'grisma.name.np',
};

const LANDING_PAGE = 'https://imagengine.grisma.info.np';

/**
 * Universal upstream candidate resolver
 * Pattern 1 (Subdomain):     /{tenant}/{subdomain}/{path}-{origExt}.{targetExt}
 * Pattern 2 (Main Domain):   /{tenant}/{path}-{origExt}.{targetExt}
 * Pattern 3 (Explicit Main): /{tenant}/main/{path}-{origExt}.{targetExt}
 */
function resolveUpstream(cleanPath, query = {}) {
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const tenantKey = segments[0].toLowerCase();
  const domain = TENANTS[tenantKey];
  if (!domain) return null;

  let originHost = '';
  let assetPath = '';
  let secondaryHost = null;
  let secondaryPath = '';

  if (segments.length === 2) {
    // /{tenant}/{assetPath} -> main domain direct
    originHost = domain;
    assetPath = segments[1];
  } else {
    const sub = segments[1].toLowerCase();
    if (sub === 'main' || sub === 'www' || sub === '@') {
      // /{tenant}/main/{...assetPath} -> explicit main domain
      originHost = domain;
      assetPath = segments.slice(2).join('/');
    } else {
      // /{tenant}/{subdomain}/{...assetPath} -> probe subdomain first, fallback to domain folder
      originHost = `${sub}.${domain}`;
      assetPath = segments.slice(2).join('/');
      secondaryHost = domain;
      secondaryPath = `${sub}/${assetPath}`;
    }
  }

  // Parse preserved origin extension: {name}-{origExt}.{targetExt} or {name}.{origExt}.{targetExt}
  const matchDash = assetPath.match(/^(.*)-(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i);
  const matchDot = !matchDash && assetPath.match(/^(.*)\.(jpe?g|png|webp|gif|svg|avif)\.([a-z0-9]+)$/i);
  const match = matchDash || matchDot;

  let candidates = [];
  let withoutExt = '';
  let requestedExt = '';

  if (match) {
    const basePath = match[1];
    const origExt = match[2].toLowerCase();
    requestedExt = match[3].toLowerCase();
    withoutExt = basePath;

    const exts = origExt === 'jpg' ? ['jpg', 'jpeg'] : origExt === 'jpeg' ? ['jpeg', 'jpg'] : [origExt];
    for (const e of exts) {
      candidates.push(`https://${originHost}/${basePath}.${e}`);
    }
    if (secondaryHost) {
      const secBasePath = secondaryPath.replace(/-(jpe?g|png|webp|gif|svg|avif)\.[a-z0-9]+$/i, '');
      for (const e of exts) {
        candidates.push(`https://${secondaryHost}/${secBasePath}.${e}`);
      }
    }
  } else {
    withoutExt = assetPath.replace(/\.(jpe?g|png|webp|gif|svg|avif)$/i, '');
    const extMatch = assetPath.match(/\.(jpe?g|png|webp|gif|svg|avif)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    requestedExt = ext || (query.format || 'webp').toLowerCase();

    if (ext && ext !== 'webp') {
      candidates.push(`https://${originHost}/${assetPath}`);
      if (secondaryHost) candidates.push(`https://${secondaryHost}/${secondaryPath}`);
    } else {
      // Fallback sequential probing across standard web formats
      const exts = ['webp', 'jpg', 'jpeg', 'png', 'svg'];
      for (const e of exts) {
        candidates.push(`https://${originHost}/${withoutExt}.${e}`);
      }
      if (secondaryHost) {
        const secWithoutExt = secondaryPath.replace(/\.(jpe?g|png|webp|gif|svg|avif)$/i, '');
        for (const e of exts) {
          candidates.push(`https://${secondaryHost}/${secWithoutExt}.${e}`);
        }
      }
    }
  }

  // Forward custom query params (ignoring transform keys)
  const forwardParams = new URLSearchParams();
  const engineKeys = new Set(['format', 'w', 'width', 'h', 'height', 'q', 'quality', 'avatar', 'fit', 'position', 'blur', 'sharpen']);
  for (const [k, v] of Object.entries(query)) {
    if (!engineKeys.has(k)) forwardParams.set(k, v);
  }
  const qs = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

  return {
    candidates: [...new Set(candidates)].map(url => `${url}${qs}`),
    tenantKey,
    withoutExt,
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
    return sendError(404, 'Route not found or unregistered tenant namespace');
  }

  const { candidates, withoutExt } = resolved;

  // Fetch upstream asset across candidates (fast sequential check)
  let svgContent = '';
  let rasterBuffer = null;
  let sourceContentType = '';
  let finalTargetUrl = '';

  for (const targetUrl of candidates) {
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

  const originHost = new URL(finalTargetUrl).host;

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
  const isWebpSource = sourceContentType.includes('webp') || finalTargetUrl.endsWith('.webp');
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
