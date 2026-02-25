import {useEffect} from 'react';
import {StatusBar, Text, TextInput, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {LegacyDebugShell} from './src/app/LegacyDebugShell';
import {ProductionAppShell} from './src/app/ProductionAppShell';
import {ENABLE_LEGACY_DEBUG_UI} from './src/config/uiMode';
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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ThemeProvider>
        <ThemeFontBridge />
        {ENABLE_LEGACY_DEBUG_UI ? <LegacyDebugShell /> : <ProductionAppShell />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
