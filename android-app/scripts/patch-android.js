// Runs in the cloud build after "cap add android": copies our background-service code and permissions into the project.
const fs = require('fs'), path = require('path');
const pkgDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'rohit', 'dreamtune', 'app');
fs.mkdirSync(pkgDir, { recursive: true });
['KeepAliveService.java', 'KeepAlivePlugin.java', 'MainActivity.java'].forEach(f => fs.copyFileSync(path.join('native', f), path.join(pkgDir, f)));

const mf = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = [
  'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
].filter(p => !x.includes(p)).map(p => '    <uses-permission android:name="' + p + '" />').join('\n');
x = x.replace('<application', perms + '\n    <application');
x = x.replace('</application>', '    <service android:name=".KeepAliveService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n    </application>');
fs.writeFileSync(mf, x);
console.log('patched android project');
