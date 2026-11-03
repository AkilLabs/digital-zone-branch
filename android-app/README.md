# Recall Mobiles - Android App

This is a WebView-based Android application for Recall Mobiles.

## Prerequisites

- Android Studio (Arctic Fox or later)
- JDK 8 or higher
- Android SDK with API level 24 or higher

## Setup Instructions

### 1. Install Android Studio
Download and install Android Studio from: https://developer.android.com/studio

### 2. Open the Project
1. Launch Android Studio
2. Click "Open an Existing Project"
3. Navigate to this `android-app` folder and select it
4. Wait for Gradle to sync (this may take a few minutes on first run)

### 3. Configure Your Website URL
Open `app/src/main/java/com/recallmobiles/app/MainActivity.kt` and update the URL:

```kotlin
private val WEBSITE_URL = "https://your-website-url.com"
```

Replace `"https://your-website-url.com"` with your actual website URL.

### 4. Update App Icon
The current app uses default icons. To use your custom logo:

1. Right-click on `app/src/main/res` folder
2. Select `New > Image Asset`
3. Choose "Launcher Icons (Adaptive and Legacy)"
4. Select your logo.png file
5. Click "Next" and "Finish"

### 5. Build the App

#### For Testing on Device/Emulator:
1. Connect your Android device via USB (with USB debugging enabled) OR start an Android emulator
2. Click the green "Run" button (play icon) in Android Studio
3. Select your device/emulator
4. The app will install and launch automatically

#### For Release APK:
1. Go to `Build > Generate Signed Bundle / APK`
2. Select "APK" and click "Next"
3. If you don't have a keystore:
   - Click "Create new..."
   - Fill in the required information
   - Remember your passwords!
4. Select "release" build variant
5. Click "Finish"
6. Your APK will be in `app/release/app-release.apk`

## Project Structure

```
android-app/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/recallmobiles/app/
│   │       │   └── MainActivity.kt          # Main app logic
│   │       ├── res/
│   │       │   ├── layout/
│   │       │   │   └── activity_main.xml    # UI layout
│   │       │   ├── values/
│   │       │   │   ├── strings.xml          # App name
│   │       │   │   ├── colors.xml           # Color scheme
│   │       │   │   └── themes.xml           # App theme
│   │       │   └── xml/                     # Security configs
│   │       └── AndroidManifest.xml          # App configuration
│   └── build.gradle                         # App dependencies
├── build.gradle                             # Project build config
├── settings.gradle                          # Project settings
└── gradle.properties                        # Gradle properties
```

## Features

✅ **WebView Integration** - Loads your website in a native app
✅ **Pull to Refresh** - Swipe down to reload the page
✅ **Progress Bar** - Shows loading progress
✅ **JavaScript Support** - Full JavaScript and DOM storage enabled
✅ **Back Button** - Navigate back through browser history
✅ **Error Handling** - Connection error dialogs with retry
✅ **Offline Detection** - Network state monitoring
✅ **File Access** - Support for file uploads/downloads
✅ **Portrait Mode** - Locked to portrait orientation

## Customization

### Change App Colors
Edit `app/src/main/res/values/colors.xml`

### Change App Name
Edit `app/src/main/res/values/strings.xml`

### Change Package Name
1. Go to `build.gradle` (app level)
2. Change `applicationId "com.recallmobiles.pos"` to your desired package name
3. Update the namespace in the same file
4. Update package in `AndroidManifest.xml`

### Enable Landscape Mode
In `AndroidManifest.xml`, remove or modify:
```xml
android:screenOrientation="portrait"
```

## Troubleshooting

### Gradle Sync Failed
- Make sure you have a stable internet connection
- Go to `File > Invalidate Caches / Restart`
- Try `Build > Clean Project` then `Build > Rebuild Project`

### App Not Loading Website
- Check the URL in `MainActivity.kt`
- Make sure your device has internet connection
- Check if your website has CORS restrictions
- Verify `android.permission.INTERNET` is in AndroidManifest.xml

### SSL Certificate Errors
- Make sure your website has a valid SSL certificate
- For development/testing only, you can enable cleartext traffic (already configured)

## Building for Production

Before releasing:
1. Update version in `app/build.gradle`:
   ```gradle
   versionCode 1    // Increment this for each release
   versionName "1.0"
   ```
2. Test thoroughly on multiple devices
3. Create a signed APK/Bundle (see step 5 above)
4. Upload to Google Play Console

## Support

For issues specific to:
- **Android Studio**: Check Android Developer documentation
- **WebView**: Check Android WebView documentation
- **Your Website**: Check your web application logs

## License

This is a custom app for Recall Mobiles.
