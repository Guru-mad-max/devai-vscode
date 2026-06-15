const esbuild = require('esbuild');

const isProd   = process.argv.includes('--production');
const isWatch  = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const baseOptions = {
  entryPoints: ['src/extension.ts'],
  bundle:      true,
  outfile:     'dist/extension.js',
  external:    ['vscode'],
  format:      'cjs',
  platform:    'node',
  target:      'node18',
  sourcemap:   !isProd,
  minify:      isProd,
  treeShaking: true,
  logLevel:    'info',
  define: {
    'process.env.NODE_ENV': isProd ? '"production"' : '"development"',
  },
};

if (isWatch) {
  esbuild.context(baseOptions).then(ctx => {
    ctx.watch();
    console.log('[DevAI] Watching for changes…');
  });
} else {
  esbuild.build(baseOptions).then(() => {
    console.log(`[DevAI] Build complete (${isProd ? 'production' : 'development'})`);
  }).catch(() => process.exit(1));
}
