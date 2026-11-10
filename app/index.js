/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { installGlobalErrorLogging } from './src/platform/diagnostics';
import { name as appName } from './app.json';

installGlobalErrorLogging();

AppRegistry.registerComponent(appName, () => App);
