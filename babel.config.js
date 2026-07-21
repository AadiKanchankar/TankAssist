module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated v4 ships its Babel plugin from react-native-worklets.
    // MUST stay last in the plugins list.
    plugins: ['react-native-worklets/plugin'],
  };
};
