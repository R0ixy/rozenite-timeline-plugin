// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withRozenite } = require('@rozenite/metro');

const config = getDefaultConfig(__dirname);

// Rozenite discovers every installed plugin, including rozenite-timeline-plugin.
// Set WITH_ROZENITE=false to bundle without it.
module.exports = withRozenite(config, {
  enabled: process.env.WITH_ROZENITE !== 'false',
});
