import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // Simple service health check
  if (req.method === 'GET' && !query.url && (req.url === '/' || req.url === '/api' || query.health)) {
    return res.status(200).json({
      service: 'ImageEngine',
      status: 'active',
      defaultFormat: 'webp',
      fonts: loadFonts().map(f => path.basename(f))
    });
  }

  // 1. Resolve SVG content
  let svgContent = '';
  let targetUrl = query.url;

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
    const fontFiles = loadFonts();
    const resvg = new Resvg(svgContent, {
      fitTo: { mode: 'width', value: 1200 },
      font: fontFiles.length
        ? { fontFiles, defaultFontFamily: 'Mukta', sansSerifFamily: 'Mukta', loadSystemFonts: false }
        : { loadSystemFonts: true }
    });

    const pngBuffer = resvg.render().asPng();
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer();

    // 1-Year CDN Cache Headers
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', webpBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline; filename="og-image.webp"');

    return res.status(200).send(webpBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Image rasterization failed', status: 500 });
  }
}
