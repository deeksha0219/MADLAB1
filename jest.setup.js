/* eslint-env jest */

jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  default: {
    initializeApp: jest.fn(),
    apps: [],
  },
}));

jest.mock('@react-native-firebase/auth', () => {
  const mockAuthInstance = {
    currentUser: null,
    signInWithPhoneNumber: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChanged: jest.fn((callback: (user: any) => void) => {
      callback(null);
      return jest.fn();
    }),
    useEmulator: jest.fn(),
  };
  const authFn: any = () => mockAuthInstance;
  authFn.useEmulator = jest.fn();
  return {
    __esModule: true,
    default: authFn,
  };
});

jest.mock('@react-native-firebase/firestore', () => {
  const mockFirestoreInstance = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    useEmulator: jest.fn(),
    settings: jest.fn(),
  };
  const firestoreFn: any = () => mockFirestoreInstance;
  firestoreFn.FieldValue = {
    serverTimestamp: jest.fn(() => ({ _methodName: 'serverTimestamp' })),
  };
  return {
    __esModule: true,
    default: firestoreFn,
  };
});

jest.mock('@react-native-firebase/functions', () => {
  const mockFunctionsInstance = {
    httpsCallable: jest.fn(() => jest.fn().mockResolvedValue({ data: { success: true } })),
    useEmulator: jest.fn(),
  };
  const functionsFn: any = () => mockFunctionsInstance;
  return {
    __esModule: true,
    default: functionsFn,
  };
});

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
  }),
  useRoute: () => ({
    params: {},
  }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => children,
    Screen: () => null,
  }),
}));

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
