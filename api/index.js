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

function buildDefaultSvg(title, subtitle, badge, theme = 'cyber', brand = 'ImageEngine', footerDomain = 'imagengine.grisma.info.np') {
  const rawTitle = title || 'ImageEngine — Universal Edge Image API';
  const rawSubtitle = subtitle || 'Convert any SVG into crisp PNG, JPG, or WebP at the edge with 1-year CDN caching.';
  const eBadge = escapeXml(badge || 'Open Graph Ready');

  // Themes
  const themes = {
    cyber: {
      bg0: '#030712', bg1: '#070f26', bg2: '#020617',
      glow1: '#06b6d4', glow2: '#6366f1',
      accent: '#38bdf8', badgeText: '#bae6fd',
      cardBorder: 'rgba(56, 189, 248, 0.25)',
      grid: 'rgba(56, 189, 248, 0.04)'
    },
    emerald: {
      bg0: '#02120b', bg1: '#042217', bg2: '#010905',
      glow1: '#10b981', glow2: '#0d9488',
      accent: '#34d399', badgeText: '#a7f3d0',
      cardBorder: 'rgba(52, 211, 153, 0.25)',
      grid: 'rgba(52, 211, 153, 0.04)'
    },
    sunset: {
      bg0: '#0e0517', bg1: '#1c082b', bg2: '#06010a',
      glow1: '#f43f5e', glow2: '#f59e0b',
      accent: '#fb7185', badgeText: '#fecdd3',
      cardBorder: 'rgba(244, 63, 94, 0.25)',
      grid: 'rgba(244, 63, 94, 0.04)'
    },
    midnight: {
      bg0: '#000000', bg1: '#0a0d14', bg2: '#000000',
      glow1: '#38bdf8', glow2: '#818cf8',
      accent: '#7dd3fc', badgeText: '#e0f2fe',
      cardBorder: 'rgba(255, 255, 255, 0.12)',
      grid: 'rgba(255, 255, 255, 0.03)'
    }
  };

  const t = themes[theme] || themes.cyber;

  // Font sizing & text line calculation
  const titleChars = rawTitle.length;
  let titleFontSize = 54;
  let titleLineHeight = 64;
  let maxChars = 30;

  if (titleChars > 70) {
    titleFontSize = 38;
    titleLineHeight = 48;
    maxChars = 44;
  } else if (titleChars > 35) {
    titleFontSize = 46;
    titleLineHeight = 56;
    maxChars = 34;
  }

  const titleLines = wrapText(rawTitle, maxChars, 3);
  const subtitleLines = wrapText(rawSubtitle, 52, 2);

  const isAscii = /^[\x00-\x7F]*$/.test(rawTitle);
  const letterSpacingAttr = isAscii ? ' letter-spacing="-0.03em"' : '';

  // SVG text blocks
  const titleSvg = titleLines.map((line, idx) =>
    `<text x="0" y="${idx * titleLineHeight}" fill="#ffffff" font-family="Mukta, Roboto, sans-serif" font-size="${titleFontSize}" font-weight="700"${letterSpacingAttr}>${escapeXml(line)}</text>`
  ).join('\n        ');

  const subtitleStartY = (titleLines.length * titleLineHeight) + 12;
  const subtitleSvg = subtitleLines.map((line, idx) =>
    `<text x="0" y="${subtitleStartY + (idx * 30)}" fill="#94a3b8" font-family="Mukta, Roboto, sans-serif" font-size="22" font-weight="500">${escapeXml(line)}</text>`
  ).join('\n        ');

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.bg0}" />
      <stop offset="50%" stop-color="${t.bg1}" />
      <stop offset="100%" stop-color="${t.bg2}" />
    </linearGradient>
    <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.glow1}" />
      <stop offset="100%" stop-color="${t.glow2}" />
    </linearGradient>
    <pattern id="gridPattern" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="${t.grid}" stroke-width="1.2" />
    </pattern>
    <filter id="orbBlur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="95" />
    </filter>
  </defs>

  <!-- Background Base & Grid -->
  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect width="1200" height="630" fill="url(#gridPattern)" />

  <!-- Atmospheric Glow Orbs -->
  <circle cx="1080" cy="110" r="280" fill="${t.glow1}" opacity="0.28" filter="url(#orbBlur)" />
  <circle cx="120" cy="540" r="260" fill="${t.glow2}" opacity="0.22" filter="url(#orbBlur)" />

  <!-- Outer Glass Frame -->
  <rect x="32" y="32" width="1136" height="566" rx="28" fill="rgba(255, 255, 255, 0.015)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.5" />

  <!-- Top Brand Header -->
  <g transform="translate(80, 92)">
    <!-- Icon Container -->
    <rect width="50" height="50" rx="14" fill="url(#glowGrad)" />
    <path d="M27 12L16 27h9l-2 15 13-18h-9l2-12z" fill="#ffffff" />
    <!-- Brand Title -->
    <text x="66" y="33" fill="#ffffff" font-family="Roboto, sans-serif" font-size="24" font-weight="800" letter-spacing="-0.02em">${escapeXml(brand)}</text>
    <circle cx="${66 + Math.round(brand.length * 14.5)}" cy="27" r="3.5" fill="${t.accent}" />
    <text x="${80 + Math.round(brand.length * 14.5)}" y="33" fill="#64748b" font-family="Roboto, sans-serif" font-size="15" font-weight="600">Edge Image API</text>
  </g>

  <!-- Pill Badge -->
  <g transform="translate(80, 172)">
    <rect width="${Math.max(eBadge.length * 10.5 + 44, 180)}" height="36" rx="18" fill="rgba(15, 23, 42, 0.85)" stroke="${t.cardBorder}" stroke-width="1.2" />
    <circle cx="18" cy="18" r="4.5" fill="${t.accent}" />
    <text x="32" y="23" fill="${t.badgeText}" font-family="Mukta, Roboto, sans-serif" font-size="13" font-weight="700">${eBadge}</text>
  </g>

  <!-- Title & Subtitle Container -->
  <g transform="translate(80, 275)">
    ${titleSvg}
    ${subtitleSvg}
  </g>

  <!-- Bottom Metadata Footer -->
  <g transform="translate(80, 525)">
    <line x1="0" y1="0" x2="1040" y2="0" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
    <text x="0" y="34" fill="#64748b" font-family="Roboto, sans-serif" font-size="12" font-weight="600" letter-spacing="0.08em">HIGH-RESOLUTION OPEN GRAPH SOCIAL PREVIEW</text>
    <text x="1040" y="34" fill="${t.accent}" font-family="Roboto, sans-serif" font-size="14" font-weight="700" text-anchor="end">${escapeXml(footerDomain)}</text>
  </g>
</svg>
`.trim();
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
    }
  } else if (!urlFormat) {
    const extMatch = rawPath.match(/\.(png|webp|jpg|jpeg)$/i);
    if (extMatch) {
      urlFormat = extMatch[1].toLowerCase();
      rawPath = rawPath.slice(0, -extMatch[0].length);
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

  // If user opens /api in browser without parameters, redirect to documentation
  const isHtml = req.headers.accept && req.headers.accept.includes('text/html');
  const hasParams = query.url || query.title || query.svg || slug || rawPath;
  if (isHtml && !hasParams && req.method === 'GET') {
    if (typeof res.redirect === 'function') {
      return res.redirect(302, '/docs');
    }
    res.writeHead(302, { Location: '/docs' });
    return res.end();
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
    const isElectionFolder = ['candidate', 'constituency', 'district', 'party', 'palika', 'province', 'province-assembly', 'election'].includes(folder);
    const isElectionStaticSlug = [
      'home', 'parties', 'districts', 'provinces', 'vips', 'samanupatik', 'by-elections', 'records'
    ].includes(rawPath) || rawPath.startsWith('federal-election') || rawPath.startsWith('local-election') || rawPath.startsWith('province-election') || rawPath.startsWith('records-');

    if (!targetUrl && rawPath && rawPath !== 'api' && (isTopNepaliHost || isElectionFolder || isElectionStaticSlug)) {
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
        if (fetchResult.status === 403) {
          return res.status(403).json({ error: fetchResult.error });
        }
        // Graceful fallback to dynamic card if title, slug, or rawPath is available and error is 404/5xx
        if (query.title || slug || rawPath) {
          const fallbackTitle = query.title || (slug || rawPath).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const fallbackBadge = query.badge || (folder ? folder.toUpperCase() : (isTopNepaliHost ? 'ELECTION NEPAL' : 'Open Graph Ready'));
          svgContent = buildDefaultSvg(fallbackTitle, query.subtitle, fallbackBadge, query.theme, brandName, footerDomain);
        } else {
          return res.status(fetchResult.status || 502).json({
            error: fetchResult.error || `Upstream error fetching SVG (Status ${fetchResult.status})`
          });
        }
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
    // 4. Built-in Dynamic Card (?title=... or clean :slug)
    else if (query.title || slug || rawPath) {
      const effectiveTitle = query.title || (slug || rawPath).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const effectiveBadge = query.badge || (folder ? folder.toUpperCase() : (isTopNepaliHost ? 'ELECTION NEPAL' : 'Open Graph Ready'));
      svgContent = buildDefaultSvg(effectiveTitle, query.subtitle, effectiveBadge, query.theme, brandName, footerDomain);
    }
    // 5. Default Demonstration Card
    else {
      svgContent = buildDefaultSvg(
        isTopNepaliHost ? 'Election Nepal' : 'ImageEngine API',
        isTopNepaliHost ? 'Universal Open Graph Image Service' : 'Universal SVG to Raster Edge Generator',
        isTopNepaliHost ? 'TopNepali Brand' : 'Ready for WhatsApp & Social Cards',
        query.theme,
        brandName,
        footerDomain
      );
    }

    const isValidSvg = svgContent && (svgContent.includes('<svg ') || svgContent.includes('<svg>') || svgContent.includes('<svg\n') || svgContent.includes('<svg\r'));
    if (!isValidSvg) {
      if (query.title || slug || rawPath) {
        const fallbackTitle = query.title || (slug || rawPath).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const fallbackBadge = query.badge || (folder ? folder.toUpperCase() : (isTopNepaliHost ? 'ELECTION NEPAL' : 'Open Graph Ready'));
        svgContent = buildDefaultSvg(fallbackTitle, query.subtitle, fallbackBadge, query.theme, brandName, footerDomain);
      } else {
        return res.status(400).json({ error: 'Invalid or missing SVG payload' });
      }
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
    if (!format) format = 'png';
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
