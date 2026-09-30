#!/usr/bin/env node
// Project:   dfe-hyperdx
// File:      scripts/native-arch.mjs
// Purpose:   Keep one arch's prebuilt native packages in an image tree, and fail on any other
//
// License:   MIT - HYPERI PTY LIMITED
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// The image's build stages run on the build host and install the prebuilt
// packages of every arch we publish, so a runtime tree can hold binaries for
// the wrong machine. This removes each package whose package.json `cpu` field
// excludes the target, then reads the ELF header of every file left and exits 1
// if any was built for another machine.
//
// Usage: node scripts/native-arch.mjs <amd64|arm64> <dir>...

import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

// Docker TARGETARCH -> Node's process.arch name and the ELF e_machine value.
const TARGETS = {
  amd64: { cpu: 'x64', machine: 62 },
  arm64: { cpu: 'arm64', machine: 183 },
};

const MACHINE_NAMES = { 62: 'x86-64', 183: 'aarch64' };

// readdir's Dirent reflects lstat, so symlinks are neither followed nor listed.
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

// npm's rule: a `!cpu` entry excludes, and a positive list must name the cpu.
function cpuAllows(cpu, target) {
  if (!Array.isArray(cpu)) return true;
  if (cpu.includes(`!${target}`)) return false;
  const positive = cpu.filter(c => !c.startsWith('!'));
  return (
    positive.length === 0 ||
    positive.includes(target) ||
    positive.includes('any')
  );
}

// e_machine of an ELF file, or null for anything else.
function elfMachine(file) {
  const header = Buffer.alloc(20);
  const fd = openSync(file, 'r');
  let read;
  try {
    read = readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  if (read < header.length) return null;
  if (header.readUInt32BE(0) !== 0x7f454c46) return null;
  // EI_DATA: 1 is little-endian, 2 is big-endian.
  return header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
}

function foreignPackages(dir, cpu) {
  const found = [];
  for (const file of files(dir)) {
    if (path.basename(file) !== 'package.json') continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (typeof manifest?.name !== 'string') continue;
    if (!cpuAllows(manifest.cpu, cpu)) found.push(path.dirname(file));
  }
  return found;
}

function main(argv) {
  const [arch, ...dirs] = argv;
  const target = TARGETS[arch];
  if (target === undefined || dirs.length === 0) {
    console.error('usage: native-arch.mjs <amd64|arm64> <dir>...');
    return 2;
  }

  const wrong = [];
  for (const dir of dirs) {
    for (const pkg of foreignPackages(dir, target.cpu)) {
      rmSync(pkg, { recursive: true, force: true });
      console.log(`native-arch: removed ${pkg} (not built for ${target.cpu})`);
    }
    for (const file of files(dir)) {
      const machine = elfMachine(file);
      if (machine === null) continue;
      const name = MACHINE_NAMES[machine] ?? `e_machine ${machine}`;
      console.log(`native-arch: ${file}: ${name}`);
      if (machine !== target.machine) wrong.push(file);
    }
  }

  if (wrong.length > 0) {
    console.error(
      `native-arch: ${wrong.length} binaries are not ${MACHINE_NAMES[target.machine]}:`,
    );
    for (const file of wrong) console.error(`  ${file}`);
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
