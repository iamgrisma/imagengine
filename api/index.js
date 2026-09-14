import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts', 'fonts.conf');

// Cache fonts in memory across lambda invocations
let cachedFonts = null;
function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const files = [];
  const searchDirs = [
    path.join(__dirname, 'fonts'),
    path.join(process.cwd(), 'api', 'fonts'),
    path.join(process.cwd(), 'fonts'),
    '/var/task/api/fonts',
  ];
  for (const dir of searchDirs) {
    try {
      if (fs.existsSync(dir)) {
        const found = fs.readdirSync(dir).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));
        for (const file of found) {
          files.push(path.join(dir, file));
        }
        if (files.length) break;
      }
    } catch {}
  }
  cachedFonts = files;
  return files;
}

// Multi-Tenant Allowed Organizations & Root Domains
const ORG_REGISTRY = {
  tn: 'topnepali.com',
  ecn: 'election.gov.np',
  tnnp: 'topnepali.com.np',
};

const ALLOWED_ROOT_DOMAINS = Object.values(ORG_REGISTRY);

function isAllowedUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_ROOT_DOMAINS.some(root => host === root || host.endsWith('.' + root));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // CORS: Allow GET and HEAD for public CDN and client latency measuring
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match, x-engine-key');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control, X-Render-Engine, X-Origin-Host');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query || {};

  // Parse incoming path from Vercel rewrite or URL
  const rawPath = req.headers['x-matched-path'] || req.url || '';
  const [pathname, searchStr] = rawPath.split('?');
  const cleanPath = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  // Favicon ignore
  if (cleanPath === 'favicon.ico') {
    return res.status(204).end();
  }

  // Simple service health check
  if (req.method === 'GET' && !query.url && (cleanPath === '' || cleanPath === 'api' || query.health)) {
    return res.status(200).json({
      service: 'ImageEngine',
      status: 'active',
      defaultEngine: 'sharp',
      defaultFormat: 'webp',
      organizations: Object.keys(ORG_REGISTRY),
      fonts: loadFonts().map(f => path.basename(f))
    });
  }

  function sendError(status, message) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    return res.status(status).json({ error: message, status });
  }

  // Detect requested output format from extension (.webp, .png, .jpg, .jpeg) or query.format
  const extMatch = cleanPath.match(/\.(webp|png|jpe?g)$/i);
  const requestedExt = (extMatch ? extMatch[1] : (query.format || 'webp')).toLowerCase().replace('jpeg', 'jpg');

  // Strip extension to get clean route slug
  const pathWithoutExt = cleanPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');

  let targetUrl = query.url;
  let originHost = '';
  let isAvatarMode = false;
  let orgKey = '';

  // Forward any relevant query parameters (e.g. year=2079, locale=ne)
  const forwardParams = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (key !== 'url' && key !== 'format' && key !== 'engine' && key !== 'w' && key !== 'h' && key !== 'avatar') {
      forwardParams.set(key, val);
    }
  }
  const forwardQuery = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

  if (!targetUrl && req.method === 'GET' && pathWithoutExt && pathWithoutExt !== 'api') {
    const segments = pathWithoutExt.split('/').filter(Boolean);
    const firstSegment = (segments[0] || '').toLowerCase();

    if (ORG_REGISTRY[firstSegment]) {
      // 1. Dynamic Namespaced Multi-Tenant Origin: /:org/:subdomain/:restPath*
      orgKey = firstSegment;
      const rootDomain = ORG_REGISTRY[orgKey];
      const sub = (segments[1] || '').toLowerCase();
      const restSegments = segments.slice(2);

      // Auto-compute origin hostname dynamically (no manual config per subdomain!)
      if (!sub || sub === 'main' || sub === 'www' || sub === '@') {
        originHost = rootDomain;
      } else {
        originHost = `${sub}.${rootDomain}`;
      }

      const restPath = restSegments.join('/');

      if (orgKey === 'ecn') {
        // ECN Candidate photos & assets:
        // Handles /ecn/result/Images/Candidate/335208.webp AND /ecn/result/candidate/335208.webp
        isAvatarMode = true;
        if (restPath.toLowerCase().startsWith('candidate/')) {
          const candId = restPath.split('/')[1] || '';
          targetUrl = `https://${originHost}/Images/Candidate/${candId}.jpg`;
        } else if (restPath.toLowerCase().startsWith('images/candidate/')) {
          targetUrl = `https://${originHost}/${restPath}.jpg`;
        } else {
          const hasExt = restPath.match(/\.(jpe?g|png|webp|gif|svg)$/i);
          targetUrl = `https://${originHost}/${restPath}${hasExt ? '' : '.jpg'}`;
        }
      } else {
        // TopNepali apps (election, news, constitution, etc.)
        if (restPath.startsWith('og/')) {
          targetUrl = `https://${originHost}/${restPath}.svg${forwardQuery}`;
        } else if (restPath.match(/\.(svg|png|jpe?g|webp|gif)$/i)) {
          targetUrl = `https://${originHost}/${restPath}${forwardQuery}`;
        } else {
          // Default clean slug to /og/:path.svg on that origin
          targetUrl = `https://${originHost}/og/${restPath}.svg${forwardQuery}`;
        }
      }
    } else {
      // 2. Legacy backwards-compatible fallback (e.g. /candidate/sobita-gautam.webp)
      orgKey = 'tn';
      originHost = 'election.topnepali.com';
      let routeSlug = pathWithoutExt;
      if (routeSlug === 'og') routeSlug = 'home';
      const upstreamSlug = routeSlug.startsWith('og/') ? routeSlug : `og/${routeSlug}`;
      targetUrl = `https://${originHost}/${upstreamSlug}.svg${forwardQuery}`;
    }
  }

  let svgContent = '';
  let rasterBuffer = null;

  if (targetUrl) {
    if (!isAllowedUrl(targetUrl)) {
      return sendError(403, 'Forbidden: Upstream domain not allowed');
    }

    try {
      const upstream = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
      if (!upstream.ok) {
        return sendError(upstream.status || 404, `Upstream returned HTTP ${upstream.status}`);
      }

      const contentTypeHeader = (upstream.headers.get('content-type') || '').toLowerCase();
      const isSvg = contentTypeHeader.includes('svg') || targetUrl.includes('.svg');

      if (isSvg) {
        svgContent = await upstream.text();
      } else {
        const arrayBuf = await upstream.arrayBuffer();
        rasterBuffer = Buffer.from(arrayBuf);
      }
    } catch (err) {
      return sendError(502, `Failed to fetch upstream asset: ${err.message}`);
    }
  } else if (req.method === 'POST') {
    // Direct POST is strictly restricted to authenticated internal callers
    const authKey = req.headers['x-engine-key'] || req.headers['authorization'];
    const secretKey = process.env.ENGINE_SECRET_KEY || 'topnepali-internal-2082';
    if (!authKey || (authKey !== secretKey && authKey !== `Bearer ${secretKey}`)) {
      return sendError(403, 'Forbidden: Direct SVG POST is restricted');
    }
    svgContent = typeof req.body === 'string' ? req.body : (req.body?.svg || '');
  } else {
    return sendError(404, 'Image Not Found');
  }

  try {
    let outputBuffer;
    let contentType = 'image/webp';

    if (svgContent) {
      // SVG Processing Pipeline
      if (!svgContent.includes('<svg')) {
        return sendError(404, 'Invalid or missing SVG payload');
      }
      if (svgContent.length > 500000) {
        return sendError(413, 'Payload Too Large: SVG exceeds 500KB limit');
      }
      if (svgContent.includes('<!ENTITY') || svgContent.includes('SYSTEM "')) {
        return sendError(400, 'Bad Request: External XML entities are forbidden');
      }

      const useResvg = req.headers['x-engine'] === 'resvg' || query.engine === 'resvg' || (req.url && req.url.includes('engine=resvg'));

      if (useResvg) {
        const fontFiles = loadFonts();
        const resvg = new Resvg(svgContent, {
          fitTo: { mode: 'width', value: 1200 },
          font: fontFiles.length
            ? { fontFiles, defaultFontFamily: 'Mukta', sansSerifFamily: 'Mukta', loadSystemFonts: false }
            : { loadSystemFonts: true }
        });
        const pngBuffer = resvg.render().asPng();
        res.setHeader('X-Render-Engine', 'resvg');

        if (requestedExt === 'webp') {
          outputBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer();
          contentType = 'image/webp';
        } else if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
          outputBuffer = await sharp(pngBuffer).jpeg({ quality: 85 }).toBuffer();
          contentType = 'image/jpeg';
        } else {
          outputBuffer = pngBuffer;
          contentType = 'image/png';
        }
      } else {
        // Sharp with Pango + HarfBuzz
        res.setHeader('X-Render-Engine', 'sharp-svg');
        const pipeline = sharp(Buffer.from(svgContent), { density: 150 }).resize(1200);

        if (requestedExt === 'webp') {
          outputBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
          contentType = 'image/webp';
        } else if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
          outputBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
          contentType = 'image/jpeg';
        } else {
          outputBuffer = await pipeline.png().toBuffer();
          contentType = 'image/png';
        }
      }
    } else if (rasterBuffer) {
      // Raster Image Pipeline (ECN candidate photos, JPG, PNG, etc.)
      if (rasterBuffer.length < 50) {
        return sendError(404, 'Empty or invalid image payload');
      }

      res.setHeader('X-Render-Engine', 'sharp-raster');
      let pipeline = sharp(rasterBuffer);

      const isAvatar = isAvatarMode || query.avatar === '1' || query.avatar === 'true';
      const targetW = query.w ? parseInt(query.w, 10) : (isAvatar ? 256 : null);
      const targetH = query.h ? parseInt(query.h, 10) : (isAvatar ? 256 : null);

      if (targetW && targetH) {
        pipeline = pipeline.resize(targetW, targetH, {
          fit: 'cover',
          position: isAvatar ? 'top' : 'center', // Face-crop for candidate portraits
        });
      } else if (targetW) {
        pipeline = pipeline.resize(targetW);
      }

      if (requestedExt === 'webp') {
        outputBuffer = await pipeline.webp({ quality: 82 }).toBuffer();
        contentType = 'image/webp';
      } else if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
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

    // 1-Year CDN Cache Headers
    if (originHost) {
      res.setHeader('X-Origin-Host', originHost);
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    return res.status(200).send(outputBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Image rasterization failed', status: 500 });
  }
}
