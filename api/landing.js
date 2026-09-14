/**
 * ImageEngine Public Documentation & Landing Page
 * Self-contained, responsive, high-performance HTML/CSS
 */
export function getLandingHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ImageEngine • Edge Image Optimization & Dynamic CDN</title>
  <meta name="description" content="Multi-tenant edge image rasterizer, face-aware smart cropper, and dynamic WebP optimization engine powered by Sharp, libvips, and Cloudflare Edge.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030712;
      --card-bg: rgba(11, 19, 43, 0.7);
      --card-border: rgba(56, 189, 248, 0.18);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #0284c7;
      --accent: #38bdf8;
      --success: #10b981;
      --warning: #f59e0b;
      --code-bg: #050b1a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      padding: 0;
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(2, 132, 199, 0.12) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(56, 189, 248, 0.08) 0%, transparent 45%);
    }
    .container { max-width: 1040px; margin: 0 auto; padding: 32px 20px 80px; }
    
    /* Header */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 48px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .logo-group { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      background: linear-gradient(135deg, #0284c7, #38bdf8);
      width: 42px;
      height: 42px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.4);
    }
    .logo-text { font-size: 1.4rem; font-weight: 900; letter-spacing: -0.5px; color: #fff; }
    .version-tag {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--accent);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .header-links { display: flex; align-items: center; gap: 20px; font-size: 0.9rem; font-weight: 600; }
    .header-links a { color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
    .header-links a:hover { color: #fff; }
    .btn-cta-nav {
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      color: #fff !important;
      padding: 8px 16px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(2, 132, 199, 0.3);
    }
    .btn-cta-nav:hover { opacity: 0.95; }

    /* Hero */
    .hero { text-align: center; margin-bottom: 56px; }
    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 20px;
    }
    h1 {
      font-size: 2.7rem;
      font-weight: 900;
      line-height: 1.15;
      letter-spacing: -1px;
      margin-bottom: 16px;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 50%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero-sub {
      font-size: 1.12rem;
      color: var(--text-muted);
      max-width: 680px;
      margin: 0 auto 32px;
      font-weight: 400;
    }
    .badge-grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-badge {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 8px 16px;
      font-size: 0.82rem;
      font-weight: 600;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stat-badge strong { color: var(--accent); }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 28px;
      margin-bottom: 32px;
      backdrop-filter: blur(12px);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
    }
    h2 {
      font-size: 1.45rem;
      font-weight: 800;
      color: #fff;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    h2 .icon { color: var(--accent); }
    p { color: #cbd5e1; font-size: 0.98rem; margin-bottom: 16px; }

    /* Architecture / Syntax diagram */
    .syntax-box {
      background: var(--code-bg);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 12px;
      padding: 16px 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.92rem;
      color: #38bdf8;
      overflow-x: auto;
      margin: 20px 0;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
    }
    .syntax-part { font-weight: 700; color: #f43f5e; }
    .syntax-sub { font-weight: 700; color: #fbbf24; }
    .syntax-path { font-weight: 700; color: #34d399; }
    .syntax-ext { font-weight: 700; color: #a78bfa; }

    .explainer-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .explainer-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
    }
    .explainer-title {
      font-size: 0.85rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .explainer-desc { font-size: 0.86rem; color: var(--text-muted); line-height: 1.5; margin: 0; }

    /* Code blocks */
    pre {
      background: var(--code-bg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 18px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #e2e8f0;
      overflow-x: auto;
      line-height: 1.6;
      margin: 14px 0;
    }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.88em; color: var(--accent); }

    /* Table */
    .table-box { overflow-x: auto; margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left; }
    th {
      background: rgba(15, 23, 42, 0.8);
      padding: 12px 16px;
      font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      text-transform: uppercase;
      font-size: 0.78rem;
      letter-spacing: 0.5px;
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      color: #cbd5e1;
    }
    tr:last-child td { border-bottom: none; }

    /* Rate limits banner */
    .limit-banner {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.15), rgba(15, 23, 42, 0.6));
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 14px;
      padding: 20px;
      margin-top: 20px;
    }

    /* CTA Box */
    .cta-box {
      text-align: center;
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.25), rgba(11, 19, 43, 0.8));
      border: 1.5px solid rgba(56, 189, 248, 0.4);
      border-radius: 20px;
      padding: 40px 24px;
      margin-top: 48px;
      box-shadow: 0 16px 48px rgba(2, 132, 199, 0.25);
    }
    .cta-title { font-size: 1.8rem; font-weight: 900; color: #fff; margin-bottom: 12px; }
    .cta-sub { color: #cbd5e1; font-size: 1.05rem; max-width: 600px; margin: 0 auto 24px; }
    .btn-cta-primary {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      color: #ffffff;
      text-decoration: none;
      font-weight: 800;
      font-size: 1.05rem;
      padding: 14px 28px;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(2, 132, 199, 0.4);
      transition: all 0.2s ease;
    }
    .btn-cta-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 26px rgba(2, 132, 199, 0.6);
    }

    /* Footer */
    footer {
      text-align: center;
      padding-top: 40px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-group">
        <div class="logo-badge">⚡</div>
        <span class="logo-text">ImageEngine</span>
        <span class="version-tag">v2.0 CDN</span>
      </div>
      <nav class="header-links">
        <a href="#syntax">API Syntax</a>
        <a href="#params">Transforms</a>
        <a href="#fallback">Client Script</a>
        <a href="#onboarding" class="btn-cta-nav">Get Access</a>
      </nav>
    </header>

    <section class="hero">
      <div class="hero-pill">⚡ Powered by Sharp & libvips on Cloudflare Global Edge</div>
      <h1>Next-Gen Edge Image Optimization</h1>
      <p class="hero-sub">
        Stateless, multi-tenant image rasterization and WebP compression pipeline. Transforms SVG, JPEG, and PNG assets on-the-fly with 1-year immutable global edge caching.
      </p>

      <div class="badge-grid">
        <div class="stat-badge">⚡ TTFB: <strong>&lt; 15ms Edge Cache</strong></div>
        <div class="stat-badge">📦 Compression: <strong>85%+ WebP Savings</strong></div>
        <div class="stat-badge">🛡️ Isolation: <strong>Namespaced Origin Security</strong></div>
        <div class="stat-badge">🎯 Engine: <strong>Hardware-Accelerated Sharp</strong></div>
      </div>
    </section>

    <!-- Syntax & Architecture -->
    <section id="syntax" class="card">
      <h2><span class="icon">📐</span> Universal API URL Structure</h2>
      <p>
        ImageEngine utilizes a <strong>Multi-Tenant Namespaced Origin Architecture</strong>. Each request specifies an approved organization identifier and dynamic subdomain:
      </p>

      <div class="syntax-box">
        https://img.topnepali.com/<span class="syntax-part">{identifier}</span>/<span class="syntax-sub">{subdomain}</span>/<span class="syntax-path">{path/to/asset}</span>.<span class="syntax-ext">webp</span>
      </div>

      <div class="explainer-grid">
        <div class="explainer-item">
          <div class="explainer-title" style="color: #f43f5e;">1. {identifier}</div>
          <p class="explainer-desc">
            The approved organization token (e.g. <code>tn</code>, <code>ecn</code>). Bound strictly to a verified root domain.
          </p>
        </div>
        <div class="explainer-item">
          <div class="explainer-title" style="color: #fbbf24;">2. {subdomain}</div>
          <p class="explainer-desc">
            Any app or microservice under that root domain (e.g. <code>election</code>, <code>news</code>, <code>result</code>). Dynamically resolved with zero manual engine configuration.
          </p>
        </div>
        <div class="explainer-item">
          <div class="explainer-title" style="color: #34d399;">3. {path}</div>
          <p class="explainer-desc">
            The relative resource path at the upstream origin (e.g. <code>og/candidate/sobita-gautam</code>, <code>Images/Candidate/341145</code>).
          </p>
        </div>
        <div class="explainer-item">
          <div class="explainer-title" style="color: #a78bfa;">4. {extension}</div>
          <p class="explainer-desc">
            Desired output format (<code>.webp</code>, <code>.png</code>, or <code>.jpg</code>). Default is ultra-lightweight WebP.
          </p>
        </div>
      </div>
    </section>

    <!-- Supported Transformations -->
    <section id="params" class="card">
      <h2><span class="icon">⚙️</span> Transformation Query Parameters</h2>
      <p>You can fine-tune image dimensions, face positioning, and compression on any endpoint:</p>

      <div class="table-box">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>w</code> / <code>width</code></td>
              <td>Integer</td>
              <td>Original / 256</td>
              <td>Target width in pixels. Maintains aspect ratio if height is omitted.</td>
            </tr>
            <tr>
              <td><code>h</code> / <code>height</code></td>
              <td>Integer</td>
              <td>Original / 256</td>
              <td>Target height in pixels.</td>
            </tr>
            <tr>
              <td><code>avatar</code></td>
              <td>Boolean</td>
              <td>Auto</td>
              <td>When <code>true</code>, applies face-aware headshot cropping focusing on the top/center.</td>
            </tr>
            <tr>
              <td><code>format</code></td>
              <td>String</td>
              <td><code>webp</code></td>
              <td>Override format: <code>webp</code>, <code>png</code>, or <code>jpg</code>.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Embeddable Fallback Script -->
    <section id="fallback" class="card">
      <h2><span class="icon">🛡️</span> Zero-Downtime Client Fallback Script</h2>
      <p>
        Drop this lightweight snippet into your website's <code>&lt;head&gt;</code>. If an image transform encounters rate-limiting or an origin 404, the browser automatically falls back to your raw origin image with zero broken UI:
      </p>

      <pre>&lt;!-- ImageEngine Smart Fallback Handler --&gt;
&lt;script&gt;
  document.addEventListener('error', function(e) {
    if (e.target && e.target.tagName === 'IMG' && e.target.src.includes('img.topnepali.com')) {
      const fallback = e.target.dataset.fallback;
      if (fallback && e.target.src !== fallback) {
        e.target.src = fallback;
      }
    }
  }, true);
&lt;/script&gt;</pre>

      <p style="margin-top: 12px; font-size: 0.88rem; color: var(--text-muted);">
        Usage in HTML: <code>&lt;img src="https://img.topnepali.com/{id}/{sub}/pic.webp" data-fallback="https://{sub}.{domain}/pic.jpg" /&gt;</code>
      </p>
    </section>

    <!-- Quotas & Rate Limits -->
    <section class="card">
      <h2><span class="icon">📊</span> CDN Quotas & Rate Limits</h2>
      <p>
        ImageEngine separates <strong>New Image Transformations</strong> (first-time rasterization) from <strong>Global Edge CDN Delivery</strong>. Once an image is rendered, assets are cached on Cloudflare Global Edge with <strong>1-year immutable caching</strong>:
      </p>

      <div class="limit-banner">
        <ul style="list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: 0.94rem;">
          <li>🟢 <strong>Global Edge CDN Delivery (Cache HIT):</strong> <span style="color: #34d399; font-weight: 800;">UNLIMITED &amp; 100% FREE</span> — Millions of global requests served at sub-15ms edge latency with zero origin load.</li>
          <li>🟡 <strong>New Image Transforms (Cache MISS):</strong>
            <div style="margin-top: 6px; padding-left: 20px; font-size: 0.88rem; color: #cbd5e1; line-height: 1.7;">
              • Daily Quota: <strong>1,000 unique images / day</strong><br>
              • Monthly Quota: <strong>15,000 unique images / month</strong><br>
              • Annual Cap: <strong>100,000 unique transforms / year</strong>
            </div>
          </li>
          <li>🔵 <strong>Internal Ecosystem:</strong> Unthrottled priority execution with dedicated throughput.</li>
        </ul>
      </div>
    </section>

    <!-- Onboarding & Contact CTA -->
    <section id="onboarding" class="cta-box">
      <div class="cta-title">Need Domain Approval or Higher Limits?</div>
      <p class="cta-sub">
        To connect your organization or whitelist your domain on the ImageEngine Edge CDN, submit an onboarding request.
      </p>
      <a href="https://grisma.info.np/contact" target="_blank" rel="noopener noreferrer" class="btn-cta-primary">
        <span>🚀 Submit Approval Request</span>
        <span style="font-size: 0.85em; opacity: 0.8;">(grisma.info.np/contact)</span>
      </a>
    </section>

    <footer>
      <p>© 2026 ImageEngine CDN • Designed & Built by <a href="https://grisma.info.np" target="_blank" rel="noopener noreferrer">Grisma</a> • TopNepali Network</p>
    </footer>
  </div>
</body>
</html>`;
}
