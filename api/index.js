import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import crypto from 'crypto';

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

function buildDefaultSvg(title, subtitle, badge) {
  const eTitle = escapeXml(title || 'ImageEngine');
  const eSubtitle = escapeXml(subtitle || 'Universal High-Performance SVG to Image Edge API');
  const eBadge = escapeXml(badge || 'Open Graph Ready');

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#050811" />
      <stop offset="50%" stop-color="#0b1329" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="100%" stop-color="#6366f1" />
    </linearGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="110" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <circle cx="1060" cy="140" r="280" fill="#0ea5e9" opacity="0.22" filter="url(#blur)" />
  <circle cx="140" cy="520" r="260" fill="#6366f1" opacity="0.18" filter="url(#blur)" />
  <rect x="36" y="36" width="1128" height="558" rx="28" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.5" />

  <g transform="translate(80, 96)">
    <rect width="52" height="52" rx="14" fill="url(#glow)" />
    <text x="26" y="35" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="900" text-anchor="middle">⚡</text>
    <text x="70" y="35" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="800">ImageEngine</text>
    <text x="236" y="35" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600">| Edge Image API</text>
  </g>

  <g transform="translate(80, 185)">
    <rect width="260" height="38" rx="19" fill="#0f172a" stroke="rgba(14, 165, 233, 0.45)" stroke-width="1" />
    <circle cx="20" cy="19" r="4.5" fill="#38bdf8" />
    <text x="36" y="24" fill="#bae6fd" font-family="system-ui, monospace" font-size="13" font-weight="700">${eBadge}</text>
  </g>

  <g transform="translate(80, 310)">
    <text x="0" y="0" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="900" letter-spacing="-1">${eTitle}</text>
  </g>

  <g transform="translate(80, 375)">
    <text x="0" y="0" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="500">${eSubtitle}</text>
  </g>

  <g transform="translate(80, 500)">
    <line x1="0" y1="0" x2="1040" y2="0" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
    <text x="0" y="36" fill="#475569" font-family="system-ui, monospace" font-size="13" font-weight="600">HIGH-RESOLUTION OPEN GRAPH SOCIAL PREVIEW</text>
    <text x="1040" y="36" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="14" font-weight="700" text-anchor="end">imagengine.grisma.com.np</text>
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
  const hasParams = req.query.url || req.query.title || req.query.svg;
  if (isHtml && !hasParams && req.method === 'GET') {
    return res.redirect(302, '/docs');
  }

  try {
    let svgContent = '';

    // 1. Remote SVG URL Mode (?url=https://...)
    if (req.query.url) {
      const sourceUrl = decodeURIComponent(req.query.url);

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
            'User-Agent': 'ImageEngine/1.0 (+https://imagengine.grisma.com.np)',
            'Accept': 'image/svg+xml,application/xml,text/xml,*/*',
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        return res.status(502).json({ error: `Upstream error fetching SVG (Status ${upstream.status})` });
      }

      svgContent = await upstream.text();
    }
    // 2. Direct POST Raw SVG Body
    else if (req.method === 'POST' && typeof req.body === 'string' && req.body.includes('<svg')) {
      svgContent = req.body;
    }
    // 3. Built-in Dynamic Card (?title=...&subtitle=...&badge=...)
    else if (req.query.title) {
      svgContent = buildDefaultSvg(req.query.title, req.query.subtitle, req.query.badge);
    }
    // 4. Default Demonstration Card
    else {
      svgContent = buildDefaultSvg(
        'ImageEngine API',
        'Universal SVG to Raster Edge Generator',
        'Ready for WhatsApp & Social Cards'
      );
    }

    if (!svgContent || !svgContent.includes('<svg')) {
      return res.status(400).json({ error: 'Invalid or missing SVG payload' });
    }

    // Payload size safeguard to prevent memory abuse
    if (Buffer.byteLength(svgContent, 'utf8') > MAX_SVG_SIZE_BYTES) {
      return res.status(413).json({ error: 'SVG payload exceeds 512 KB limit' });
    }

    const width = Math.min(Math.max(parseInt(req.query.width, 10) || 1200, 100), 2400);
    const format = (req.query.format || 'png').toLowerCase();
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 85, 10), 100);

    // Rasterize SVG via Rust-compiled Resvg core
    const resvg = new Resvg(svgContent, {
      fitTo: { mode: 'width', value: width },
    });
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
