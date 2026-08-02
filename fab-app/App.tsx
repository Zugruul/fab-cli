/**
 * fab-app — FAB companion app (React Native, iOS-first)
 * See ../SPEC-APP.md §9 onward. Navigation is a single screen for now
 * (APP-030 scaffold); the device smoke screen exercises the four native
 * pillars: llama.rn, op-sqlite (+sqlite-vec), vision-camera, fast-tflite.
 *
 * @format
 */

import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SmokeScreen } from './src/smokeScreen/SmokeScreen';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <SmokeScreen />
    </SafeAreaProvider>
  );
}

export default App;
