#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');

// Read package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Create output filename
const vsixName = `${pkg.publisher}.${pkg.name}-${pkg.version}.vsix`;
const outputPath = path.join('vsix-output', vsixName);

console.log(`Creating VSIX package: ${vsixName}`);

// Create a zip archive
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 }
});

output.on('close', () => {
  console.log(`✅ Package created: ${outputPath}`);
  console.log(`   File size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
});

archive.on('error', (err) => {
  console.error(`❌ Error creating archive:`, err);
  process.exit(1);
});

archive.pipe(output);

// Add files to archive under 'extension/' path for proper VSIX format
const filesToInclude = [
  'out/',
  'package.json',
  'README.md',
  'LICENSE',
  'package-lock.json'
];

for (const file of filesToInclude) {
  const fullPath = path.join('.', file);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      archive.directory(fullPath, `extension/${file}`);
    } else {
      archive.file(fullPath, { name: `extension/${file}` });
    }
  }
}

// Add node_modules under extension path
if (fs.existsSync('node_modules')) {
  archive.directory('node_modules', 'extension/node_modules');
}

archive.finalize();
