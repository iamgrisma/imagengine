import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache font buffers in memory across Lambda invocations
let cachedFontBuffers = null;
function loadFontBuffers() {
  if (cachedFontBuffers && cachedFontBuffers.length) return cachedFontBuffers;
  const buffers = [];
  const searchDirs = [
    path.join(__dirname, 'fonts'),
    path.join(process.cwd(), 'api', 'fonts'),
    path.join(process.cwd(), 'fonts'),
  ];
  for (const dir of searchDirs) {
    try {
      const bold = path.join(dir, 'Roboto-Bold.ttf');
      const reg = path.join(dir, 'Roboto-Regular.ttf');
      if (fs.existsSync(bold)) {
        buffers.push(fs.readFileSync(bold));
        if (fs.existsSync(reg)) {
          buffers.push(fs.readFileSync(reg));
        }
        break;
      }
    } catch (e) {
      // Continue search
    }
  }
  cachedFontBuffers = buffers;
  return buffers;
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

function buildDefaultSvg(title, subtitle, badge, theme = 'cyber') {
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

  // SVG text blocks
  const titleSvg = titleLines.map((line, idx) =>
    `<text x="0" y="${idx * titleLineHeight}" fill="#ffffff" font-family="Roboto, sans-serif" font-size="${titleFontSize}" font-weight="900" letter-spacing="-0.03em">${escapeXml(line)}</text>`
  ).join('\n        ');

  const subtitleStartY = (titleLines.length * titleLineHeight) + 12;
  const subtitleSvg = subtitleLines.map((line, idx) =>
    `<text x="0" y="${subtitleStartY + (idx * 30)}" fill="#94a3b8" font-family="Roboto, sans-serif" font-size="22" font-weight="500">${escapeXml(line)}</text>`
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
    <text x="25" y="34" fill="#ffffff" font-family="Roboto, sans-serif" font-size="24" font-weight="900" text-anchor="middle">⚡</text>
    <!-- Brand Title -->
    <text x="66" y="33" fill="#ffffff" font-family="Roboto, sans-serif" font-size="24" font-weight="800" letter-spacing="-0.02em">ImageEngine</text>
    <circle cx="218" cy="27" r="3.5" fill="${t.accent}" />
    <text x="232" y="33" fill="#64748b" font-family="Roboto, sans-serif" font-size="15" font-weight="600">Edge Image API</text>
  </g>

  <!-- Pill Badge -->
  <g transform="translate(80, 172)">
    <rect width="${Math.max(eBadge.length * 10.5 + 44, 180)}" height="36" rx="18" fill="rgba(15, 23, 42, 0.85)" stroke="${t.cardBorder}" stroke-width="1.2" />
    <circle cx="18" cy="18" r="4.5" fill="${t.accent}" />
    <text x="32" y="23" fill="${t.badgeText}" font-family="Roboto, sans-serif" font-size="13" font-weight="700">${eBadge}</text>
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
    <text x="1040" y="34" fill="${t.accent}" font-family="Roboto, sans-serif" font-size="14" font-weight="700" text-anchor="end">imagengine.grisma.info.np</text>
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

  // If user opens /api in browser without parameters, redirect to documentation
  const isHtml = req.headers.accept && req.headers.accept.includes('text/html');
  const query = req.query || {};
  const hasParams = query.url || query.title || query.svg;
  if (isHtml && !hasParams && req.method === 'GET') {
    if (typeof res.redirect === 'function') {
      return res.redirect(302, '/docs');
    }
    res.writeHead(302, { Location: '/docs' });
    return res.end();
  }

  try {
    let svgContent = '';

    // 1. Remote SVG URL Mode (?url=https://...)
    if (query.url) {
      const sourceUrl = decodeURIComponent(query.url);

      if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid URL scheme. Only HTTP and HTTPS are permitted.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let upstream;
      try {
        upstream = await fetch(sourceUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'ImageEngine/1.0 (+https://imagengine.grisma.info.np)',
            'Accept': 'image/svg+xml,application/xml,text/xml,*/*',
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        // Graceful fallback to dynamic card if title is available
        if (query.title) {
          svgContent = buildDefaultSvg(query.title, query.subtitle, query.badge, query.theme);
        } else {
          return res.status(502).json({ error: `Upstream error fetching SVG (Status ${upstream.status})` });
        }
      } else {
        svgContent = await upstream.text();
      }
    }
    // 2. Direct POST Raw SVG Body
    else if (req.method === 'POST') {
      const raw = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : (typeof req.body === 'string' ? req.body : (req.body ? JSON.stringify(req.body) : ''));
      if (raw && raw.includes('<svg')) {
        svgContent = raw;
      }
    }
    // 3. Built-in Dynamic Card (?title=...&subtitle=...&badge=...)
    else if (query.title) {
      svgContent = buildDefaultSvg(query.title, query.subtitle, query.badge, query.theme);
    }
    // 4. Default Demonstration Card
    else {
      svgContent = buildDefaultSvg(
        'ImageEngine API',
        'Universal SVG to Raster Edge Generator',
        'Ready for WhatsApp & Social Cards',
        query.theme
      );
    }

    if (!svgContent || !svgContent.includes('<svg')) {
      return res.status(400).json({ error: 'Invalid or missing SVG payload' });
    }

    // Payload size safeguard to prevent memory abuse
    if (Buffer.byteLength(svgContent, 'utf8') > MAX_SVG_SIZE_BYTES) {
      return res.status(413).json({ error: 'SVG payload exceeds 512 KB limit' });
    }

    const width = Math.min(Math.max(parseInt(query.width, 10) || 1200, 100), 2400);
    const format = (query.format || 'png').toLowerCase();
    const quality = Math.min(Math.max(parseInt(query.quality, 10) || 85, 10), 100);

    // Load font buffers (bundled Roboto fonts)
    const fontBuffers = loadFontBuffers();
    const resvgOptions = {
      fitTo: { mode: 'width', value: width },
    };

    if (fontBuffers && fontBuffers.length > 0) {
      resvgOptions.font = {
        fontBuffers,
        defaultFontFamily: 'Roboto',
        loadSystemFonts: true,
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

    return res.status(200).send(outputBuffer);
  } catch (error) {
    // Return sanitized error without internal stack traces
    return res.status(500).json({ error: error.message || 'Image Generation Failed' });
  }
}
