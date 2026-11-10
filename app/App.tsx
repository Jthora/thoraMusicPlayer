import {useEffect} from 'react';
import {StatusBar, Text, TextInput, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AppErrorBoundary} from './src/app/AppErrorBoundary';
import {LegacyDebugShell} from './src/app/LegacyDebugShell';
import {ProductionAppShell} from './src/app/ProductionAppShell';
import {ENABLE_LEGACY_DEBUG_UI} from './src/config/uiMode';
import {logDiagnostic, markAppReady} from './src/platform/diagnostics';
import {kvStoreBackend} from './src/platform/storage/kvStore';
import {ThemeProvider, useTheme} from './src/ui/themeRuntime';

function ThemeFontBridge() {
  const {fontFamily} = useTheme();

  useEffect(() => {
    const TextComponent = Text as typeof Text & {defaultProps?: {style?: unknown}};
    TextComponent.defaultProps = TextComponent.defaultProps || {};
    TextComponent.defaultProps.style = [{fontFamily}];

    const TextInputComponent = TextInput as typeof TextInput & {defaultProps?: {style?: unknown}};
    TextInputComponent.defaultProps = TextInputComponent.defaultProps || {};
    TextInputComponent.defaultProps.style = [{fontFamily}];
  }, [fontFamily]);

  return null;
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    markAppReady();
    logDiagnostic('info', 'app', 'mounted', {kvStore: kvStoreBackend});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppErrorBoundary>
        <ThemeProvider>
          <ThemeFontBridge />
          {ENABLE_LEGACY_DEBUG_UI ? <LegacyDebugShell /> : <ProductionAppShell />}
        </ThemeProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

export default App;
