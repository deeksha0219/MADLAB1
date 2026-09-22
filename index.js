/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { configureFirebase } from './src/config/firebase';

// Initialize Firebase and emulator configuration strictly once at application launch
configureFirebase();

AppRegistry.registerComponent(appName, () => App);
