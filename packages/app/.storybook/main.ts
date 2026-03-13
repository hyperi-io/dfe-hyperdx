// This file has been automatically migrated to valid ESM format by Storybook.
import { createRequire } from 'node:module';
import { dirname, join } from 'path';
import type { StorybookConfig } from '@storybook/nextjs';

const require = createRequire(import.meta.url);

const ALLOWED_PACKAGE_PREFIXES = [
  '@storybook/addon-links',
  '@storybook/addon-styling-webpack',
  '@storybook/addon-docs',
  '@storybook/nextjs',
];
function getAbsolutePath(value: string): string {
  if (
    !ALLOWED_PACKAGE_PREFIXES.some(
      p => value === p || value.startsWith(p + '/'),
    )
  ) {
    throw new Error(`Invalid package path: ${value}`);
  }
  return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-links'),
    getAbsolutePath('@storybook/addon-styling-webpack'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: {
    name: getAbsolutePath('@storybook/nextjs'),
    options: {},
  },
  staticDirs: ['./public'],
  webpackFinal: async config => {
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'next/router': require.resolve('next/router'),
      };
    }
    return config;
  },
};

export default config;
