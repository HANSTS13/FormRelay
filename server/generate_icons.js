const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Ensure destination directories exist
const destDirs = [
  path.join(__dirname, '..', 'formrelay', 'extension', 'icons'),
  path.join(__dirname, '..', 'extension', 'icons'),
  path.join(__dirname, 'public', 'icons')
];

for (const dir of destDirs) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Generate an SVG logo string
const svgLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4F46E5" />
      <stop offset="50%" stop-color="#6366F1" />
      <stop offset="100%" stop-color="#0EA5E9" />
    </linearGradient>
    <linearGradient id="paper" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F1F5F9" />
    </linearGradient>
    <linearGradient id="arrow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#06B6D4" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#1E1B4B" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Outer Rounded Squircle with Vibrant Gradient -->
  <rect x="8" y="8" width="112" height="112" rx="28" fill="url(#bg)" filter="url(#shadow)" />

  <!-- Inner Document Form Base -->
  <rect x="28" y="26" width="54" height="76" rx="8" fill="url(#paper)" opacity="0.95" />

  <!-- Form Lines (representing input fields) -->
  <rect x="36" y="38" width="28" height="5" rx="2.5" fill="#6366F1" />
  <rect x="36" y="49" width="38" height="4.5" rx="2.25" fill="#94A3B8" />
  <rect x="36" y="59" width="32" height="4.5" rx="2.25" fill="#94A3B8" />
  <rect x="36" y="69" width="22" height="4.5" rx="2.25" fill="#94A3B8" />

  <!-- Shield / Security Checkmark Badge -->
  <circle cx="44" cy="85" r="7" fill="#10B981" />
  <path d="M41 85 l2.5 2.5 l4.5 -4.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />

  <!-- Relay Arc / Fast Forward Arrow -->
  <g filter="url(#shadow)">
    <!-- Relay Node Orbit -->
    <path d="M 68 46 C 92 46, 102 62, 100 80 C 98 94, 82 102, 68 98" fill="none" stroke="url(#arrow)" stroke-width="6.5" stroke-linecap="round" />
    
    <!-- Relay Arrowhead -->
    <polygon points="98,42 110,48 98,56 102,49" fill="#06B6D4" />

    <!-- Pulse Dot -->
    <circle cx="98" cy="74" r="5" fill="#FFFFFF" />
    <circle cx="98" cy="74" r="3" fill="#10B981" />
  </g>
</svg>`;

// Write SVG to destinations
for (const dir of destDirs) {
  fs.writeFileSync(path.join(dir, 'logo.svg'), svgLogo);
  fs.writeFileSync(path.join(dir, '..', 'logo.svg'), svgLogo);
}

// Generate pixel-crisp PNG icons using PNGJS
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const radius = size * 0.44;
  const cornerR = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Squircle distance formula
      const dx = Math.abs(x - center + 0.5);
      const dy = Math.abs(y - center + 0.5);
      const maxD = radius;

      // Rounded rect check
      let inSquircle = false;
      const innerW = maxD - cornerR;
      if (dx <= maxD && dy <= maxD) {
        if (dx <= innerW || dy <= innerW) {
          inSquircle = true;
        } else {
          const cornerDist = Math.hypot(dx - innerW, dy - innerW);
          inSquircle = cornerDist <= cornerR;
        }
      }

      if (inSquircle) {
        // Gradient from #4F46E5 (Indigo) to #06B6D4 (Cyan)
        const t = (x + y) / (size * 2);
        const r1 = 79,  g1 = 70,  b1 = 229;  // #4F46E5
        const r2 = 6,   g2 = 182, b2 = 212;  // #06B6D4
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);

        // Document silhouette in white
        const docLeft = size * 0.22;
        const docRight = size * 0.65;
        const docTop = size * 0.20;
        const docBottom = size * 0.80;

        const inDoc = (x >= docLeft && x <= docRight && y >= docTop && y <= docBottom);

        // Relay Arrow path
        const inArrowStem = (x >= size * 0.52 && x <= size * 0.84 && y >= size * 0.48 && y <= size * 0.60);
        const inArrowHead = (x >= size * 0.72 && x <= size * 0.90 && Math.abs(y - size * 0.54) <= (size * 0.90 - x) * 0.8);

        if (inArrowHead || inArrowStem) {
          // Vibrant Emerald / Cyan relay arrow
          png.data[idx] = 16;      // R
          png.data[idx + 1] = 185; // G
          png.data[idx + 2] = 129; // B (#10B981)
          png.data[idx + 3] = 255;
        } else if (inDoc) {
          // Check for form lines inside document
          const lineX = (x >= docLeft + size * 0.08 && x <= docRight - size * 0.08);
          const isLine1 = lineX && Math.abs(y - (docTop + size * 0.12)) <= Math.max(1, size * 0.03);
          const isLine2 = lineX && Math.abs(y - (docTop + size * 0.26)) <= Math.max(1, size * 0.025);
          const isLine3 = lineX && Math.abs(y - (docTop + size * 0.40)) <= Math.max(1, size * 0.025);

          if (isLine1) {
            png.data[idx] = 99;   // Indigo line
            png.data[idx + 1] = 102;
            png.data[idx + 2] = 241;
            png.data[idx + 3] = 255;
          } else if (isLine2 || isLine3) {
            png.data[idx] = 148;  // Slate lines
            png.data[idx + 1] = 163;
            png.data[idx + 2] = 184;
            png.data[idx + 3] = 255;
          } else {
            png.data[idx] = 255;  // White document
            png.data[idx + 1] = 255;
            png.data[idx + 2] = 255;
            png.data[idx + 3] = 245;
          }
        } else {
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      } else {
        // Transparent outside
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      }
    }
  }

  const buffer = PNG.sync.write(png);
  for (const dir of destDirs) {
    fs.writeFileSync(path.join(dir, 'icon' + size + '.png'), buffer);
  }
  console.log('Generated icon' + size + '.png in all directories');
}

console.log('Logo and icons generation complete!');
