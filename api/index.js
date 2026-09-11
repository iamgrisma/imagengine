import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
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
  const eSubtitle = escapeXml(subtitle || 'Free Universal SVG to Image Edge API');
  const eBadge = escapeXml(badge || 'Edge Generated');

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="90" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <circle cx="1020" cy="160" r="240" fill="#0284c7" opacity="0.25" filter="url(#blur)" />
  <circle cx="180" cy="480" r="220" fill="#6366f1" opacity="0.2" filter="url(#blur)" />
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="none" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1.5" />

  <g transform="translate(80, 100)">
    <rect width="48" height="48" rx="12" fill="url(#glow)" />
    <text x="24" y="32" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="900" text-anchor="middle">⚡</text>
    <text x="64" y="32" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800">ImageEngine</text>
    <text x="220" y="32" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600">| imagengine.grisma.com.np</text>
  </g>

  <g transform="translate(80, 180)">
    <rect width="280" height="36" rx="18" fill="#0f172a" stroke="rgba(56, 189, 248, 0.4)" stroke-width="1" />
    <circle cx="18" cy="18" r="4" fill="#38bdf8" />
    <text x="32" y="23" fill="#93c5fd" font-family="system-ui, monospace" font-size="13" font-weight="700">${eBadge}</text>
  </g>

  <g transform="translate(80, 300)">
    <text x="0" y="0" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="900" letter-spacing="-1">${eTitle}</text>
  </g>

  <g transform="translate(80, 360)">
    <text x="0" y="0" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="500">${eSubtitle}</text>
  </g>

  <g transform="translate(80, 490)">
    <line x1="0" y1="0" x2="1040" y2="0" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />
    <text x="0" y="38" fill="#64748b" font-family="system-ui, monospace" font-size="13" font-weight="600">HIGH RESOLUTION OPEN GRAPH SOCIAL PREVIEW</text>
    <text x="1040" y="38" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="14" font-weight="700" text-anchor="end">imagengine.grisma.com.np</text>
  </g>
</svg>
`.trim();
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      const upstream = await fetch(sourceUrl);
      if (!upstream.ok) {
        return res.status(502).json({ error: 'Failed to fetch SVG from source URL' });
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
    // 4. Default Demo Card
    else {
      svgContent = buildDefaultSvg('ImageEngine API', 'Universal SVG to Raster Edge Generator', 'Ready for WhatsApp & Social Previews');
    }

    if (!svgContent || !svgContent.includes('<svg')) {
      return res.status(400).json({ error: 'Invalid or missing SVG payload' });
    }

    const width = Math.min(Math.max(parseInt(req.query.width, 10) || 1200, 100), 2400);
    const format = (req.query.format || 'png').toLowerCase();
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 85, 10), 100);

    // Rasterize SVG with Resvg (Rust core)
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

    // Set Edge CDN Cache Headers (1 Year CDN cache, stale-while-revalidate)
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, stale-while-revalidate=86400');
    return res.status(200).send(outputBuffer);
  } catch (error) {
    console.error('ImageEngine Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Image Generation Error' });
  }
}
