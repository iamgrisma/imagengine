import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache font files and directories in memory across Lambda invocations
let cachedFontFiles = null;
let cachedFontDirs = null;

function loadFonts() {
  if (cachedFontFiles && cachedFontFiles.length) return { fontFiles: cachedFontFiles, fontDirs: cachedFontDirs };
  const files = [];
  const dirs = [];
  const loadedNames = new Set();
  const searchDirs = [
    path.join(__dirname, 'fonts'),
    path.join(__dirname, '..', 'api', 'fonts'),
    path.join(__dirname, '..', 'fonts'),
    path.join(process.cwd(), 'api', 'fonts'),
    path.join(process.cwd(), 'fonts'),
    '/var/task/api/fonts',
    '/var/task/fonts',
  ];
  for (const dir of searchDirs) {
    try {
      if (fs.existsSync(dir)) {
        dirs.push(dir);
        const found = fs.readdirSync(dir)
          .filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));
        for (const file of found) {
          if (!loadedNames.has(file)) {
            const fullPath = path.join(dir, file);
            files.push(fullPath);
            loadedNames.add(file);
          }
        }
      }
    } catch {}
  }
  cachedFontFiles = files;
  cachedFontDirs = dirs;
  return { fontFiles: files, fontDirs: dirs };
}

async function getRequestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') {
    if (typeof req.body.svg === 'string') return req.body.svg;
    return JSON.stringify(req.body);
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

// Strict Allowlist of Authorized Root Domains (includes all subdomains)
const ALLOWED_ROOT_DOMAINS = [
  'topnepali.com',
  'grisma.com.np',
  'grisma.info.np',
  'vercel.app'
];

/**
 * Validates whether an upstream SVG URL is permitted.
 * Strictly enforces HTTPS protocol, standard port, and allowed domain/subdomain whitelist.
 */
function isAllowedUpstreamUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port && parsed.port !== '443') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_ROOT_DOMAINS.some(root => host === root || host.endsWith('.' + root));
  } catch {
    return false;
  }
}

/**
 * Fetches an upstream SVG while strictly checking each redirect hop against the domain allowlist.
 */
async function fetchAllowedSvg(sourceUrl, signal) {
  let currentUrl = sourceUrl;
  let redirects = 0;
  const maxRedirects = 3;

  while (redirects <= maxRedirects) {
    if (!isAllowedUpstreamUrl(currentUrl)) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden: Upstream domain not permitted. Only authorized domains (*.topnepali.com, *.grisma.com.np, *.grisma.info.np) are allowed.'
      };
    }

    const res = await fetch(currentUrl, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'ImageEngine/2.0 (+https://img.topnepali.com; Cloudflare-Edge-Rasterizer)',
        'Accept': 'image/svg+xml,application/xml,text/xml,*/*',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { ok: false, status: res.status, error: 'Upstream redirect missing Location header' };
      }
      currentUrl = new URL(location, currentUrl).href;
      redirects++;
      continue;
    }

    if (res.status !== 200) {
      return {
        ok: false,
        status: res.status,
        error: `Upstream server returned HTTP ${res.status}`
      };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('svg') && !contentType.includes('xml') && !contentType.includes('text/plain')) {
      return {
        ok: false,
        status: 415,
        error: `Upstream server returned non-SVG content-type: ${contentType}`
      };
    }

    return { ok: true, status: 200, response: res };
  }

  return { ok: false, status: 508, error: 'Too many redirects from upstream server' };
}

const MAX_SVG_SIZE_BYTES = 512 * 1024; // 512 KB payload guard
const FETCH_TIMEOUT_MS = 6000;

function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function wrapText(text, maxCharsPerLine = 34, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/);
  if (!words.length || !words[0]) return [];
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines;
}

function buildDefaultSvg(title, subtitle, badge, theme = 'dark', brand = 'TopNepali', footerDomain = 'election.topnepali.com') {
  const rawTitle = title || 'TopNepali Election Engine';
  const rawSubtitle = subtitle || 'Official Election Social Preview & Realtime Results';
  const eBadge = escapeXml(badge || 'ELECTION NEPAL');

  const titleLines = wrapText(rawTitle, 32, 3);
  const subtitleLines = wrapText(rawSubtitle, 52, 2);

  const titleSvg = titleLines.map((line, idx) =>
    `<text x="0" y="${idx * 60}" fill="#ffffff" font-family="Mukta, Roboto, sans-serif" font-size="48" font-weight="700">${escapeXml(line)}</text>`
  ).join('\n        ');

  const subtitleStartY = (titleLines.length * 60) + 16;
  const subtitleSvg = subtitleLines.map((line, idx) =>
    `<text x="0" y="${subtitleStartY + (idx * 30)}" fill="#94a3b8" font-family="Mukta, Roboto, sans-serif" font-size="22" font-weight="500">${escapeXml(line)}</text>`
  ).join('\n        ');

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#030712" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="100%" stop-color="#38bdf8" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect x="32" y="32" width="1136" height="566" rx="24" fill="rgba(255, 255, 255, 0.02)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.5" />
  <g transform="translate(80, 90)">
    <rect width="42" height="42" rx="10" fill="url(#brandGrad)" />
    <text x="56" y="28" fill="#ffffff" font-family="Roboto, sans-serif" font-size="22" font-weight="800">${escapeXml(brand)}</text>
  </g>
  <g transform="translate(80, 160)">
    <rect width="${Math.max(eBadge.length * 10.5 + 32, 140)}" height="32" rx="16" fill="rgba(15, 23, 42, 0.85)" stroke="rgba(56, 189, 248, 0.3)" stroke-width="1.2" />
    <circle cx="16" cy="16" r="4" fill="#38bdf8" />
    <text x="28" y="21" fill="#bae6fd" font-family="Mukta, Roboto, sans-serif" font-size="13" font-weight="700">${eBadge}</text>
  </g>
  <g transform="translate(80, 260)">
    ${titleSvg}
    ${subtitleSvg}
  </g>
  <g transform="translate(80, 530)">
    <line x1="0" y1="0" x2="1040" y2="0" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
    <text x="0" y="32" fill="#64748b" font-family="Roboto, sans-serif" font-size="13" font-weight="600">OPEN GRAPH SOCIAL PREVIEW</text>
    <text x="1040" y="32" fill="#38bdf8" font-family="Roboto, sans-serif" font-size="14" font-weight="700" text-anchor="end">${escapeXml(footerDomain)}</text>
  </g>
</svg>`.trim();
}

export default async function handler(req, res) {
  // Global CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query || {};

  // Instant runtime health check for deployment & font inspection
  if (query.health === '1' || query.health === 'true') {
    const { fontFiles } = loadFonts();
    return res.status(200).json({
      status: 'ok',
      version: '2.6.0',
      allowedDomains: ALLOWED_ROOT_DOMAINS,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      __dirname,
      fonts: (fontFiles || []).map(f => path.basename(f)),
      fontCount: (fontFiles || []).length,
      searchDirs: [
        path.join(__dirname, 'fonts'),
        path.join(process.cwd(), 'api', 'fonts'),
        path.join(process.cwd(), 'fonts'),
        '/var/task/api/fonts'
      ].map(d => ({ path: d, exists: fs.existsSync(d) }))
    });
  }

  // Parse clean pathname if routed via /:slug.:ext or /:folder/:slug.:ext
  const host = req.headers.host || 'img.topnepali.com';
  const rawReqUrl = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url;
  const urlObj = new URL(rawReqUrl, `http://${host}`);
  const pathname = urlObj.pathname;
  let slug = query.slug || '';
  let folder = query.folder || '';
  let urlFormat = (query.format || '').toLowerCase();
  let rawPath = query.path ? String(query.path).replace(/^\/+/, '') : '';

  if (!rawPath) {
    const extMatch = pathname.match(/\.(png|webp|jpg|jpeg)$/i);
    if (extMatch) {
      if (!urlFormat) urlFormat = extMatch[1].toLowerCase();
      rawPath = pathname.slice(1, -extMatch[0].length);
    } else if (pathname && pathname !== '/' && pathname !== '/api') {
      rawPath = pathname.replace(/^\/+/, '');
      if (!urlFormat) urlFormat = 'webp';
    }
  } else if (!urlFormat) {
    const extMatch = rawPath.match(/\.(png|webp|jpg|jpeg)$/i);
    if (extMatch) {
      urlFormat = extMatch[1].toLowerCase();
      rawPath = rawPath.slice(0, -extMatch[0].length);
    } else {
      urlFormat = 'webp';
    }
  }

  // Strip leading 'og/' if present
  if (rawPath.startsWith('og/')) {
    rawPath = rawPath.slice(3);
  }

  const parts = rawPath.split('/').filter(Boolean);
  if (!slug) {
    if (parts.length > 1) {
      folder = folder || parts[0];
      slug = parts.slice(1).join('/');
    } else if (parts.length === 1 && parts[0] !== 'api') {
      slug = parts[0];
    }
  }

  const isTopNepaliHost = host.includes('topnepali.com');
  const brandName = isTopNepaliHost ? 'TopNepali' : 'ImageEngine';
  const footerDomain = isTopNepaliHost ? 'election.topnepali.com' : 'imagengine.grisma.info.np';

  // If request arrives without parameters, return lightweight JSON status
  const hasParams = query.url || query.title || query.svg || slug || rawPath;
  if (!hasParams && req.method === 'GET') {
    return res.status(200).json({
      service: 'TopNepali Edge Image Engine',
      status: 'active',
      defaultFormat: 'webp',
      allowedDomains: ALLOWED_ROOT_DOMAINS
    });
  }

  try {
    let svgContent = '';

    // 1. Resolve Remote SVG Target URL or Folder Shortcut
    let targetUrl = query.url;
    if (!targetUrl && req.url && req.url.includes('url=')) {
      const idx = req.url.indexOf('url=');
      targetUrl = req.url.slice(idx + 4);
    }

    // Direct /raw/ or /p/ proxy: e.g. /raw/https://randomsite.com/path/abc.svg
    if (!targetUrl && (pathname.startsWith('/raw/') || pathname.startsWith('/p/'))) {
      const rawPrefix = pathname.startsWith('/raw/') ? '/raw/' : '/p/';
      let rawTarget = pathname.slice(rawPrefix.length);
      if (urlObj.search) rawTarget += urlObj.search;
      rawTarget = rawTarget.replace(/\.(png|webp|jpg|jpeg)$/i, '');
      if (!rawTarget.startsWith('http://') && !rawTarget.startsWith('https://')) {
        rawTarget = 'https://' + rawTarget;
      }
      targetUrl = rawTarget;
    }

    // 2. Election Nepal Canonical Slugs: Map directly to dynamic vector SVG
    // Supports /candidate/:slug, /constituency/:id, /district/:slug, /party/:slug, /palika/:id,
    // /province/:slug, /province-assembly/:slug, /home, /federal-election-*, /local-election-*,
    // /parties, /districts, /provinces, /samanupatik, /by-elections, /records-*, etc.
    if (rawPath.startsWith('local/palika/')) {
      rawPath = rawPath.replace('local/palika/', 'palika/');
      const updatedParts = rawPath.split('/').filter(Boolean);
      folder = updatedParts[0] || '';
      slug = updatedParts.slice(1).join('/');
    }

    const isElectionFolder = ['candidate', 'constituency', 'district', 'party', 'palika', 'province', 'province-assembly', 'election'].includes(folder);
    const isElectionStaticSlug = [
      'home', 'parties', 'districts', 'provinces', 'vips', 'samanupatik', 'by-elections', 'records'
    ].includes(rawPath) || rawPath.startsWith('federal-election') || rawPath.startsWith('local-election') || rawPath.startsWith('province-election') || rawPath.startsWith('records-');

    if (!targetUrl && rawPath && rawPath !== 'api' && (isElectionFolder || isElectionStaticSlug)) {
      const upstreamSlug = folder === 'election' ? `candidate/${slug}` : rawPath;

      const forwardParams = new URLSearchParams();
      for (const [key, val] of Object.entries(query)) {
        if (!['path', 'format', 'width', 'quality', 'slug', 'folder', 'theme', 'url'].includes(key)) {
          forwardParams.set(key, val);
        }
      }
      const forwardQuery = forwardParams.toString() ? `?${forwardParams.toString()}` : '';
      targetUrl = `https://election.topnepali.com/og/${upstreamSlug}.svg${forwardQuery}`;
    }

    if (targetUrl) {
      let sourceUrl = targetUrl;
      // Decode only if it starts with encoded http%3A or contains percent encoding
      if (sourceUrl.startsWith('http%3A') || sourceUrl.startsWith('https%3A')) {
        try {
          sourceUrl = decodeURIComponent(sourceUrl);
        } catch {}
      }

      // Security Guard: Strictly reject any upstream URL not in the allowed domains
      if (!isAllowedUpstreamUrl(sourceUrl)) {
        return res.status(403).json({
          error: 'Forbidden: Upstream domain not permitted. Only authorized domains (*.topnepali.com, *.grisma.com.np, *.grisma.info.np) are allowed.'
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let fetchResult;
      try {
        fetchResult = await fetchAllowedSvg(sourceUrl, controller.signal);
      } catch (err) {
        if (err.name === 'AbortError') {
          return res.status(504).json({ error: 'Gateway Timeout fetching upstream SVG' });
        }
        return res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
      } finally {
        clearTimeout(timeout);
      }

      if (!fetchResult.ok) {
        return res.status(fetchResult.status || 404).json({
          error: fetchResult.error || 'Image Not Found',
          status: fetchResult.status || 404
        });
      } else {
        svgContent = await fetchResult.response.text();
      }
    }
    // 3. Direct POST Raw SVG Body
    else if (req.method === 'POST') {
      const raw = await getRequestBody(req);
      if (raw && raw.includes('<svg')) {
        svgContent = raw;
      }
    }
    // 4. Built-in Dynamic Card (explicit ?title= query only)
    else if (query.title) {
      const effectiveTitle = query.title;
      const effectiveBadge = query.badge || (isTopNepaliHost ? 'ELECTION NEPAL' : 'Open Graph Ready');
      svgContent = buildDefaultSvg(effectiveTitle, query.subtitle, effectiveBadge, query.theme, brandName, footerDomain);
    }
    // 5. Unknown route or missing image
    else {
      return res.status(404).json({ error: 'Image Not Found', status: 404 });
    }

    const isValidSvg = svgContent && (svgContent.includes('<svg ') || svgContent.includes('<svg>') || svgContent.includes('<svg\n') || svgContent.includes('<svg\r'));
    if (!isValidSvg) {
      return res.status(404).json({ error: 'Invalid or missing SVG payload', status: 404 });
    }

    // Payload size safeguard to prevent memory abuse
    if (Buffer.byteLength(svgContent, 'utf8') > MAX_SVG_SIZE_BYTES) {
      return res.status(413).json({ error: 'SVG payload exceeds 512 KB limit' });
    }

    const width = Math.min(Math.max(parseInt(query.width, 10) || 1200, 100), 2400);
    let format = (urlFormat || query.format || '').toLowerCase();
    if (!format && req.url) {
      const extMatch = req.url.split('?')[0].match(/\.(png|webp|jpg|jpeg)$/i);
      if (extMatch) format = extMatch[1].toLowerCase();
    }
    if (!format) format = 'webp';
    const quality = Math.min(Math.max(parseInt(query.quality, 10) || 85, 10), 100);

    // Load static font files & dirs (Mukta for Devanagari & Latin, Roboto)
    const { fontFiles, fontDirs } = loadFonts();
    const resvgOptions = {
      fitTo: { mode: 'width', value: width },
    };

    if (fontFiles && fontFiles.length > 0) {
      resvgOptions.font = {
        fontFiles,
        fontDirs,
        defaultFontFamily: 'Mukta',
        sansSerifFamily: 'Mukta',
        serifFamily: 'Mukta',
        loadSystemFonts: false,
      };
    } else {
      resvgOptions.font = {
        loadSystemFonts: true,
      };
    }

    // Rasterize SVG via Rust-compiled Resvg core
    const resvg = new Resvg(svgContent, resvgOptions);
    const pngBuffer = resvg.render().asPng();

    let outputBuffer = pngBuffer;
    let contentType = 'image/png';

    // Convert format if requested (jpg / webp)
    if (format === 'jpg' || format === 'jpeg') {
      outputBuffer = await sharp(pngBuffer).jpeg({ quality }).toBuffer();
      contentType = 'image/jpeg';
    } else if (format === 'webp') {
      outputBuffer = await sharp(pngBuffer).webp({ quality }).toBuffer();
      contentType = 'image/webp';
    }

    // Generate ETag from output buffer
    const etag = `"${crypto.createHash('md5').update(outputBuffer).digest('hex')}"`;

    // Handle Conditional GET (If-None-Match) -> 304 Not Modified
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800');
      return res.status(304).end();
    }

    // Set Edge CDN Caching Headers (Vercel Edge, Cloudflare CDN, RFC standard)
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('ETag', etag);

    // Standard HTTP / Browser + Shared Caches (1 Year TTL, 1 Week SWR)
    res.setHeader(
      'Cache-Control',
      'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=86400'
    );

    // RFC 9213 / Cloudflare standard edge CDN control
    res.setHeader(
      'CDN-Cache-Control',
      'public, max-age=31536000, stale-while-revalidate=604800'
    );

    // Explicit Vercel Edge CDN instruction (overrides serverless defaults)
    res.setHeader(
      'Vercel-CDN-Cache-Control',
      'public, max-age=31536000, stale-while-revalidate=604800'
    );

    // Explicit Cloudflare Edge Cache instruction
    res.setHeader(
      'Cloudflare-CDN-Cache-Control',
      'public, max-age=31536000, stale-while-revalidate=604800'
    );

    // Edge surrogate standard
    res.setHeader('Surrogate-Control', 'max-age=31536000');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('X-Engine-Fonts', String(fontFiles ? fontFiles.length : 0));
    res.setHeader('X-Engine-Version', '2.6.0');

    // Set Content-Disposition header with clean file name
    let downloadName = 'image';
    if (slug && slug !== 'api' && slug !== 'render' && slug !== 'raw' && slug !== 'p') {
      downloadName = slug.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '_');
    } else if (rawPath && rawPath !== 'api') {
      downloadName = rawPath.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '_');
    } else if (targetUrl) {
      try {
        const u = new URL(targetUrl);
        const base = path.basename(u.pathname).replace(/\.(svg|png|webp|jpg|jpeg)$/gi, '');
        if (base && base !== '/') downloadName = base.replace(/[^a-zA-Z0-9_-]/g, '_');
      } catch {}
    }
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}.${format}"`);

    return res.status(200).send(outputBuffer);
  } catch (error) {
    // Return sanitized error without internal stack traces
    return res.status(500).json({ error: error.message || 'Image Generation Failed' });
  }
}
