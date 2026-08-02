/**
 * fab-app — FAB companion app (React Native, iOS-first)
 * See ../SPEC-APP.md §9 onward. Navigation is a single screen for now
 * (APP-030 scaffold); the device smoke screen exercises the four native
 * pillars: llama.rn, op-sqlite (+sqlite-vec), vision-camera, fast-tflite.
 *
 * I18nProvider (#217, SPEC-APP.md §9.11) wraps the whole tree — it
 * resolves the app language (persisted override, else system locale) and
 * initializes i18next before first render. LanguageSwitcher is the
 * minimal manual-override settings surface (no navigation library yet).
 *
 * @format
 */

import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from './src/i18n/I18nProvider';
import { LanguageSwitcher } from './src/i18n/LanguageSwitcher';
import { SmokeScreen } from './src/smokeScreen/SmokeScreen';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <LanguageSwitcher />
        <SmokeScreen />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

export default App;
