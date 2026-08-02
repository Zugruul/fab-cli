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
 * useTheme() (#219, SPEC-APP.md §9.13) is the single place App.tsx reads
 * the system color scheme — StatusBar's dark/light content style folds
 * into the same theme resolution every screen below uses (src/theme/),
 * rather than App.tsx computing `useColorScheme() === 'dark'` on its own.
 *
 * @format
 */

import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from './src/i18n/I18nProvider';
import { LanguageSwitcher } from './src/i18n/LanguageSwitcher';
import { SmokeScreen } from './src/smokeScreen/SmokeScreen';
import { useTheme } from './src/theme';

function App(): React.JSX.Element {
  const { name } = useTheme();

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar barStyle={name === 'dark' ? 'light-content' : 'dark-content'} />
        <LanguageSwitcher />
        <SmokeScreen />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

export default App;
