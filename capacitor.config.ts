import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.speakerrepairs.srclickup',
  appName: 'SRClickUp',
  webDir: 'dist',
  server: {
    url: 'https://srclickup.web.app',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK',
      signingType: 'apksigner'
    }
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#1e293b",
      showSpinner: false
    },
    StatusBar: {
      backgroundColor: "#1e293b",
      style: "light"
    }
  }
};

export default config;
