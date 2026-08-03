const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// #144 APP-036: the workspace root's .npmrc sets node-linker=hoisted, so
// devDependencies shared across the pnpm workspace (e.g. @babel/runtime,
// needed at bundle time for Babel's injected helpers, not just at
// transform time) live in the monorepo root's node_modules, not
// fab-app/node_modules. Metro only resolves files reachable through
// projectRoot + watchFolders (see metro docs "Configuration Structure") —
// without this, a Release archive's "Bundle React Native code and images"
// phase fails with Metro's UnableToResolveError even though plain
// `node -e "require.resolve(...)"` finds the file fine from fab-app.
const monorepoRoot = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [monorepoRoot],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
