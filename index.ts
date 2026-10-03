import { registerRootComponent } from 'expo';

import App from './App';
// Registers the on-duty background location task before any screen mounts.
import './lib/dutyLocation';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
