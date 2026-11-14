// Runs in the cloud build after "cap add android": copies our native code, permissions and libraries into the project.
const fs = require('fs'), path = require('path');
const pkgDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'rohit', 'dreamtune', 'app');
fs.mkdirSync(pkgDir, { recursive: true });
['KeepAliveService.java', 'KeepAlivePlugin.java', 'MainActivity.java', 'PlayerService.java', 'NativePlayer.java', 'YtAudio.java', 'AudioFetch.java']
  .forEach(f => fs.copyFileSync(path.join('native', f), path.join(pkgDir, f)));

// ---- manifest: permissions + services
const mf = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = [
  'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
].filter(p => !x.includes(p)).map(p => '    <uses-permission android:name="' + p + '" />').join('\n');
x = x.replace('<application', perms + '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n    <application');
x = x.replace('</application>',
  '    <service android:name=".KeepAliveService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n' +
  '    <service android:name=".PlayerService" android:exported="true" android:foregroundServiceType="mediaPlayback">\n' +
  '        <intent-filter><action android:name="androidx.media3.session.MediaSessionService" /></intent-filter>\n' +
  '    </service>\n    </application>');
fs.writeFileSync(mf, x);

// ---- gradle: JitPack (NewPipe Extractor), Media3 player, OkHttp, Java desugaring
const rootGradle = path.join('android', 'build.gradle');
let rg = fs.readFileSync(rootGradle, 'utf8');
if (!rg.includes('jitpack.io')) rg = rg.split('mavenCentral()').join("mavenCentral()\n        maven { url 'https://jitpack.io' }");
fs.writeFileSync(rootGradle, rg);

const appGradle = path.join('android', 'app', 'build.gradle');
let ag = fs.readFileSync(appGradle, 'utf8');
ag += `
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    packaging {
        resources {
            excludes.addAll(['META-INF/DEPENDENCIES', 'META-INF/LICENSE', 'META-INF/LICENSE.txt', 'META-INF/NOTICE', 'META-INF/NOTICE.txt', 'META-INF/INDEX.LIST'])
        }
    }
}
dependencies {
    implementation 'androidx.media3:media3-exoplayer:1.4.1'
    implementation 'androidx.media3:media3-session:1.4.1'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.github.TeamNewPipe:NewPipeExtractor:v0.26.5'
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'
}
`;
// ---- same signing key + rising version number on every build, so a new APK installs OVER the old app (no uninstall)
ag += `
android {
    defaultConfig {
        versionCode (System.getenv('GITHUB_RUN_NUMBER') ?: '1').toInteger()
        versionName '1.0.' + (System.getenv('GITHUB_RUN_NUMBER') ?: '1')
    }
    if (System.getenv('DT_KEYSTORE')) {
        signingConfigs {
            dt {
                storeFile file(System.getenv('DT_KEYSTORE'))
                storePassword System.getenv('DT_STORE_PASS')
                keyAlias System.getenv('DT_KEY_ALIAS')
                keyPassword System.getenv('DT_KEY_PASS')
            }
        }
        buildTypes {
            debug { signingConfig signingConfigs.dt }
        }
    }
}
`;
fs.writeFileSync(appGradle, ag);

// ---- app icon + splash screen: use the DreamTune logo instead of the default Capacitor one
const res = path.join('android', 'app', 'src', 'main', 'res');
const iconsSrc = path.join('icons');
['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(d => {
    const dir = path.join(res, 'mipmap-' + d);
    fs.mkdirSync(dir, { recursive: true });
    ['ic_launcher.png', 'ic_launcher_round.png', 'dt_icon_bg.png', 'dt_icon_fg.png']
        .forEach(f => fs.copyFileSync(path.join(iconsSrc, 'mipmap-' + d, f), path.join(dir, f)));
});
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '    <background android:drawable="@mipmap/dt_icon_bg"/>\n    <foreground android:drawable="@mipmap/dt_icon_fg"/>\n</adaptive-icon>\n';
const anyDir = path.join(res, 'mipmap-anydpi-v26');
fs.mkdirSync(anyDir, { recursive: true });
fs.writeFileSync(path.join(anyDir, 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(anyDir, 'ic_launcher_round.xml'), adaptive);
(function walk(dir) {      // replace every default splash picture
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'splash.png') fs.copyFileSync(path.join(iconsSrc, 'splash', /land/.test(dir) ? 'splash-land.png' : 'splash-port.png'), p);
    });
})(res);

console.log('patched android project');
