#!/usr/bin/env node
// Project:   dfe-hyperdx
// File:      scripts/dfe-lint-ours.mjs
// Purpose:   Lint/format-check only the files this fork controls or modified
//
// License:   MIT — HYPERI PTY LIMITED
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// The gate's scope is COMPUTED, never a path list: everything changed relative
// to the merge-base with upstream -- files we added, plus upstream files we have
// actually touched. An untouched upstream file can never appear in it, so the
// gate stays correct after every upstream sync with no list to maintain.
//
// Usage: node scripts/dfe-lint-ours.mjs <eslint|prettier>

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM_URL = 'https://github.com/hyperdxio/hyperdx.git';

// Anchored to this file, never process.cwd(): run from another checkout, a
// cwd-relative git call adds the upstream remote to that checkout instead.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const ESLINT_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PRETTIER_EXTS = new Set([
  ...ESLINT_EXTS,
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '.scss',
]);

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function ensureUpstream() {
  try {
    git('remote', 'get-url', 'upstream');
  } catch {
    git('remote', 'add', 'upstream', UPSTREAM_URL);
  }
  execFileSync(
    'git',
    [
      'fetch',
      '--quiet',
      'upstream',
      '+refs/heads/main:refs/remotes/upstream/main',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}

function mergeBase() {
  // A shallow checkout (release-path CI) has no common ancestor within its
  // horizon and merge-base exits 1 with no message; deepen once and retry.
  try {
    return git('merge-base', 'HEAD', 'upstream/main');
  } catch {
    if (git('rev-parse', '--is-shallow-repository') === 'true') {
      execFileSync('git', ['fetch', '--quiet', '--unshallow', 'origin'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      });
    }
    return git('merge-base', 'HEAD', 'upstream/main');
  }
}

function changedFiles() {
  ensureUpstream();
  const base = mergeBase();
  const out = git('diff', '--name-only', '--diff-filter=d', `${base}...HEAD`);
  return out ? out.split('\n') : [];
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return res.status ?? 1;
}

const tool = process.argv[2];
if (tool !== 'eslint' && tool !== 'prettier') {
  console.error('usage: dfe-lint-ours.mjs <eslint|prettier>');
  process.exit(2);
}

const exts = tool === 'eslint' ? ESLINT_EXTS : PRETTIER_EXTS;
const files = changedFiles().filter(
  f => exts.has(path.extname(f)) && existsSync(path.join(REPO_ROOT, f)),
);

// A sync that touches nothing of ours is legitimately green, and both tools
// error when handed an empty file list.
if (files.length === 0) {
  console.log(`dfe-lint-ours: no controlled-or-modified ${tool} files -- pass`);
  process.exit(0);
}

let status = 0;
if (tool === 'prettier') {
  console.log(`dfe-lint-ours: prettier --check over ${files.length} files`);
  status = run('yarn', ['prettier', '--check', ...files], REPO_ROOT);
} else {
  // Flat eslint configs live per package and do not cascade from the repo
  // root, so group the files by the package that owns them and run eslint
  // from each package directory. Files outside any configured package are
  // covered by prettier only.
  const byPkg = new Map();
  for (const f of files) {
    const m = f.match(/^(packages\/[^/]+)\//);
    if (!m) continue;
    const pkg = m[1];
    if (!existsSync(path.join(REPO_ROOT, pkg, 'eslint.config.mjs'))) continue;
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    byPkg.get(pkg).push(path.relative(pkg, f));
  }
  if (byPkg.size === 0) {
    console.log(
      'dfe-lint-ours: no changed files under an eslint-configured package -- pass',
    );
    process.exit(0);
  }
  for (const [pkg, pkgFiles] of byPkg) {
    console.log(`dfe-lint-ours: eslint ${pkgFiles.length} files in ${pkg}`);
    const st = run(
      'yarn',
      ['exec', 'eslint', '--no-warn-ignored', ...pkgFiles],
      path.join(REPO_ROOT, pkg),
    );
    if (st !== 0) status = st;
  }
}
process.exit(status);
