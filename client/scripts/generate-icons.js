// Generates PNG icons from SVG using sharp (if available) or writes SVG fallbacks
// Run: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// SVG source — DG monogram on brand blue
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#1e40af"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-weight="700" font-size="${size * 0.42}" fill="white" letter-spacing="-1">DG</text>
</svg>`;

// Write SVG files (browsers accept SVG for many purposes)
fs.writeFileSync(path.join(outDir, 'icon-192.svg'), svg(192));
fs.writeFileSync(path.join(outDir, 'icon-512.svg'), svg(512));

// Try to generate PNGs via sharp
try {
  const sharp = require('sharp');
  Promise.all([
    sharp(Buffer.from(svg(192))).png().toFile(path.join(outDir, 'icon-192.png')),
    sharp(Buffer.from(svg(512))).png().toFile(path.join(outDir, 'icon-512.png')),
  ]).then(() => console.log('✓ PNG icons generated')).catch(e => console.error('sharp error:', e.message));
} catch {
  // sharp not installed — copy SVGs as PNG placeholders and note to replace
  fs.copyFileSync(path.join(outDir, 'icon-192.svg'), path.join(outDir, 'icon-192.png'));
  fs.copyFileSync(path.join(outDir, 'icon-512.svg'), path.join(outDir, 'icon-512.png'));
  console.log('✓ SVG icons written (rename to .png or install sharp for true PNGs)');
}

// Also write a favicon.ico placeholder (SVG)
fs.writeFileSync(
  path.join(__dirname, '../public/favicon.ico'),
  svg(32)
);
console.log('✓ favicon written');
