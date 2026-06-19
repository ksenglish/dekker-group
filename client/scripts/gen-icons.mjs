import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

const svg = (size, rx) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#000000"/>
  <text x="${size/2}" y="${size*0.57}" dominant-baseline="middle" text-anchor="middle"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-weight="700" font-size="${Math.round(size*0.43)}" fill="white" letter-spacing="-2">DG</text>
</svg>`;

await sharp(Buffer.from(svg(192, 34))).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(svg(512, 92))).png().toFile('public/icons/icon-512.png');
await sharp(Buffer.from(svg(180, 32))).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(svg(32, 6))).png().toFile('public/favicon.png');
console.log('Icons generated successfully');
