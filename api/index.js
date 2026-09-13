import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FONTCONFIG_PATH = path.join(__dirname, 'fonts');

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

// Domain whitelist to prevent SSRF abuse
const ALLOWED_ROOT_DOMAINS = [
  'topnepali.com',
  'grisma.com.np',
  'grisma.info.np',
  'vercel.app'
];

function isAllowedUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_ROOT_DOMAINS.some(root => host === root || host.endsWith('.' + root));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control');
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
      defaultFormat: 'webp',
      fonts: loadFonts().map(f => path.basename(f))
    });
  }

  // 1. Resolve Target URL and Format
  let svgContent = '';
  let targetUrl = query.url;

  // Detect requested output format from extension (.webp, .png, .jpg, .jpeg) or query.format
  const extMatch = cleanPath.match(/\.(webp|png|jpe?g)$/i);
  const requestedExt = (extMatch ? extMatch[1] : (query.format || 'webp')).toLowerCase().replace('jpeg', 'jpg');

  // Strip extension to get clean route slug
  let routeSlug = cleanPath.replace(/\.(webp|png|jpe?g|svg)$/i, '');

  if (!targetUrl && req.method === 'GET' && routeSlug && routeSlug !== 'api') {
    // If routeSlug is 'og', it was requested as /og.webp (fallback to home)
    if (routeSlug === 'og') {
      routeSlug = 'home';
    }
    // Normalize: ensure it maps to upstream /og/:slug.svg
    const upstreamSlug = routeSlug.startsWith('og/') ? routeSlug : `og/${routeSlug}`;

    // Forward any query parameters (such as year=2079, locale=ne)
    const forwardParams = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (key !== 'url' && key !== 'format') {
        forwardParams.set(key, val);
      }
    }
    const forwardQuery = forwardParams.toString() ? `?${forwardParams.toString()}` : '';
    targetUrl = `https://election.topnepali.com/${upstreamSlug}.svg${forwardQuery}`;
  }

  if (targetUrl) {
    if (!isAllowedUrl(targetUrl)) {
      return res.status(403).json({ error: 'Forbidden: Upstream domain not allowed', status: 403 });
    }

    try {
      const upstream = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
      if (!upstream.ok) {
        return res.status(upstream.status || 404).json({
          error: `Upstream returned HTTP ${upstream.status}`,
          status: upstream.status
        });
      }
      svgContent = await upstream.text();
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch upstream SVG: ${err.message}`, status: 502 });
    }
  } else if (req.method === 'POST') {
    // Direct POST SVG payload
    svgContent = typeof req.body === 'string' ? req.body : (req.body?.svg || '');
  } else {
    // Any unknown route without a valid SVG URL -> 404
    return res.status(404).json({ error: 'Image Not Found', status: 404 });
  }

  if (!svgContent || !svgContent.includes('<svg')) {
    return res.status(404).json({ error: 'Invalid or missing SVG payload', status: 404 });
  }

  try {
    const useSharp = req.headers['x-engine'] === 'sharp' || query.engine === 'sharp' || (req.url && req.url.includes('engine=sharp'));
    let pngBuffer;
    if (useSharp) {
      pngBuffer = await sharp(Buffer.from(svgContent), { density: 150 }).resize(1200).png().toBuffer();
      res.setHeader('X-Render-Engine', 'sharp');
    } else {
      const fontFiles = loadFonts();
      const resvg = new Resvg(svgContent, {
        fitTo: { mode: 'width', value: 1200 },
        font: fontFiles.length
          ? { fontFiles, defaultFontFamily: 'Mukta', sansSerifFamily: 'Mukta', loadSystemFonts: false }
          : { loadSystemFonts: true }
      });
      pngBuffer = resvg.render().asPng();
      res.setHeader('X-Render-Engine', 'resvg');
    }
    let outputBuffer = pngBuffer;
    let contentType = 'image/png';

    if (requestedExt === 'webp') {
      outputBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer();
      contentType = 'image/webp';
    } else if (requestedExt === 'jpg' || requestedExt === 'jpeg') {
      outputBuffer = await sharp(pngBuffer).jpeg({ quality: 85 }).toBuffer();
      contentType = 'image/jpeg';
    }

    const filename = `${routeSlug ? path.basename(routeSlug) : 'og-image'}.${requestedExt}`;

    // 1-Year CDN Cache Headers
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
