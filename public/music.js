/* ==========================================================================
   StreamPulse - Music Player
   - Login / Register / Logout  (Firebase Authentication)
   - Playlists saved in your account (Firestore) so they follow you to any device
   - Songs of your playlists are downloaded on each device for offline listening
   - Home feed with infinite scroll, shuffle, repeat, +/-10 second skip
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ---- Settings you can change ----------------------------------------
    const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';        // backend address
    const HOME_QUERY = 'latest hindi songs 2026';    // Home page feed
    const AUTH_DOMAIN = 'streampulse.app';           // User ID -> "userid@streampulse.app" (never receives mail)
    // ---------------------------------------------------------------------

    const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>" +
        "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#6d28d9'/><stop offset='1' stop-color='#db2777'/></linearGradient></defs>" +
        "<rect width='400' height='400' fill='url(#g)'/>" +
        "<text x='200' y='250' font-size='160' text-anchor='middle' fill='white' fill-opacity='.85'>&#9835;</text></svg>"
    );

    const GRADS = [
        ['#f43f5e', '#fb923c'], ['#8b5cf6', '#6366f1'], ['#06b6d4', '#3b82f6'], ['#10b981', '#14b8a6'],
        ['#ec4899', '#8b5cf6'], ['#f59e0b', '#ef4444'], ['#3b82f6', '#8b5cf6'], ['#14b8a6', '#84cc16']
    ];
    const COVER_ICONS = ['favorite', 'nightlife', 'headphones', 'library_music', 'album', 'piano', 'graphic_eq', 'celebration'];

    const LIKED_ID = 'pl-liked';
    const SPEEDS = [1, 1.2, 1.3, 1.5, 1.75, 2];
    const MOODS = {
        romantic: { label: 'Romantic', e: '💖', g: ['#ff4f8b', '#ff8a5c'], sub: 'Non-stop love songs', w: /love|pyar|pyaar|ishq|ishk|mohabbat|romantic|sanam|humsafar|tum hi|saathiya|kesariya|tere liye/i, q: ['romantic hindi songs', 'arijit singh love songs', '90s romantic hindi songs', 'atif aslam romantic songs', 'new bollywood love songs 2026', 'jubin nautiyal romantic songs'] },
        sad: { label: 'Sad', e: '😢', g: ['#3b82f6', '#6366f1'], sub: 'For heavy hearts', w: /sad|dard|judai|judaai|bewafa|alvida|tanha|broken|heartbreak/i, q: ['sad hindi songs', 'heartbreak hindi songs', 'arijit singh sad songs', 'emotional bollywood songs'] },
        party: { label: 'Party', e: '🎉', g: ['#f59e0b', '#ef4444'], sub: 'Turn it up', w: /party|dj |dance|nacho|club|bhangra|badshah|honey singh/i, q: ['bollywood party songs', 'dance hits hindi', 'badshah party songs', 'hindi dj remix songs'] },
        lofi: { label: 'Lo-fi', e: '🧘', g: ['#14b8a6', '#8b5cf6'], sub: 'Slow and dreamy', w: /lofi|lo-fi|slowed|reverb|chill/i, q: ['lofi hindi songs', 'slowed reverb hindi songs', 'chill lofi bollywood'] },
        punjabi: { label: 'Punjabi', e: '🎤', g: ['#f97316', '#eab308'], sub: 'Beats and bhangra', w: /punjabi|sidhu|diljit|dhillon|aujla/i, q: ['latest punjabi songs', 'diljit dosanjh songs', 'ap dhillon songs', 'punjabi hits'] },
        devotional: { label: 'Devotional', e: '🙏', g: ['#f59e0b', '#ec4899'], sub: 'Peace and bhakti', w: /bhajan|bhakti|aarti|shiv|krishna|hanuman|mantra/i, q: ['bhakti songs', 'krishna bhajan', 'shiv bhajan', 'hanuman bhajan'] },
        retro: { label: '90s Gold', e: '🎶', g: ['#d97706', '#be185d'], sub: 'Evergreen classics', w: /90s|kumar sanu|alka yagnik|udit narayan|old is gold|evergreen|kishore|lata/i, q: ['90s hindi songs', 'kumar sanu hits', 'udit narayan alka yagnik songs', 'old hindi evergreen songs'] },
        english: { label: 'English', e: '🎸', g: ['#06b6d4', '#3b82f6'], sub: 'Pop and rock', w: /linkin|imagine dragons|ed sheeran|weeknd|taylor swift|coldplay|english/i, q: ['english pop hits', 'linkin park songs', 'imagine dragons songs', 'ed sheeran songs'] }
    };
    Object.assign(MOODS, {
        rock: { label: 'Rock', e: '🎸', g: ['#ef4444', '#7c3aed'], sub: 'Loud and live', w: /rock|metal|linkin park/i, q: ['hindi rock songs', 'english rock hits'] },
        pop: { label: 'Pop', e: '🎤', g: ['#ec4899', '#f59e0b'], sub: 'Chart toppers', w: /\bpop\b/i, q: ['pop hits', 'bollywood pop songs'] },
        hiphop: { label: 'Hip-hop', e: '🎧', g: ['#64748b', '#a855f7'], sub: 'Beats and bars', w: /\brap\b|hip hop|hip-hop|emiway|divine|raftaar/i, q: ['hindi rap songs', 'hip hop hits'] },
        sufi: { label: 'Sufi', e: '🌙', g: ['#0ea5e9', '#6366f1'], sub: 'Soulful ghazals', w: /sufi|ghazal|qawwali|nusrat|rahat/i, q: ['sufi songs', 'ghazal hits', 'rahat fateh ali khan songs'] },
        latest: { label: 'New releases', e: '✨', g: ['#22c55e', '#06b6d4'], sub: 'Fresh this week', w: /a^/, q: ['new hindi songs 2026', 'latest songs 2026'] }
    });
    const KW = { romantic: 'romantic', sad: 'sad', party: 'party', lofi: 'lofi', devotional: 'bhajan', retro: 'old classic', rock: 'rock', pop: 'pop', hiphop: 'rap', sufi: 'sufi', latest: 'new' };
    Object.keys(KW).forEach(k => { MOODS[k].kw = KW[k]; });
    MOODS.punjabi.nl = MOODS.english.nl = true;
    const LANGS = ['Hindi', 'English', 'Punjabi', 'Bhojpuri', 'Haryanvi', 'Tamil', 'Telugu', 'Bengali'];
    const SINGERS = {
        Hindi: ['Arijit Singh', 'Atif Aslam', 'Shreya Ghoshal', 'Jubin Nautiyal', 'Neha Kakkar', 'Badshah', 'Kumar Sanu', 'Udit Narayan', 'Alka Yagnik', 'Sonu Nigam', 'Lata Mangeshkar', 'Kishore Kumar', 'Darshan Raval', 'Yo Yo Honey Singh', 'B Praak'],
        English: ['Ed Sheeran', 'Taylor Swift', 'The Weeknd', 'Linkin Park', 'Imagine Dragons', 'Coldplay', 'Billie Eilish', 'Justin Bieber', 'Dua Lipa', 'Eminem', 'Bruno Mars'],
        Punjabi: ['Diljit Dosanjh', 'AP Dhillon', 'Sidhu Moose Wala', 'Karan Aujla', 'Guru Randhawa', 'Ammy Virk', 'Gurdas Maan', 'Babbu Maan', 'Jass Manak', 'Harrdy Sandhu'],
        Bhojpuri: ['Pawan Singh', 'Khesari Lal Yadav', 'Dinesh Lal Yadav Nirahua', 'Arvind Akela Kallu', 'Shilpi Raj', 'Neelkamal Singh', 'Ritesh Pandey', 'Samar Singh', 'Akshara Singh'],
        Haryanvi: ['Masoom Sharma', 'Sapna Choudhary', 'Renuka Panwar', 'Vishvajeet Choudhary', 'Ajay Hooda'],
        Tamil: ['Anirudh Ravichander', 'A. R. Rahman', 'Sid Sriram', 'Yuvan Shankar Raja', 'Dhanush'],
        Telugu: ['Sid Sriram', 'Armaan Malik', 'Anurag Kulkarni', 'Devi Sri Prasad', 'Thaman S'],
        Bengali: ['Arijit Singh', 'Anupam Roy', 'Shaan', 'Shreya Ghoshal', 'Nachiketa']
    };
    const GENRES = [['romantic', '💖 Romantic'], ['sad', '😢 Sad'], ['party', '🎉 Party / DJ'], ['lofi', '🧘 Lo-fi'], ['rock', '🎸 Rock'], ['pop', '🎤 Pop'], ['hiphop', '🎧 Hip-hop'], ['sufi', '🌙 Sufi and Ghazal'], ['retro', '🎶 Old classics'], ['latest', '✨ New releases'], ['devotional', '🙏 Devotional']];
    const MOMENTS = [['workout', '💪 Workout', 'gym workout songs'], ['study', '📚 Study', 'focus study music'], ['travel', '🚗 Travel', 'road trip songs'], ['sleep', '😴 Sleep', 'calm sleep songs'], ['work', '💼 Work', 'work chill music'], ['party', '🥳 Parties', 'party hits']];
    const detectMood = (s) => { for (const k in MOODS) if (MOODS[k].w.test(s || '')) return k; return null; };
    const SHELVES = [
        { t: 'Quick picks', q: 'latest hindi songs 2026', k: 'rows', all: 1 },
        { t: 'Mood stations', k: 'stations' },
        { t: 'Covers and remixes', q: 'hindi lofi remix songs', k: 'rows', all: 1, m: 'lofi' },
        { t: 'Punjabi vibes', q: 'latest punjabi songs', k: 'cards', m: 'punjabi' },
        { t: 'Sad and soulful', q: 'sad hindi songs', k: 'cards', m: 'sad' },
        { t: 'Party anthems', q: 'bollywood party songs', k: 'cards', m: 'party' },
        { t: 'Music videos for you', q: 'new hindi music video 2026', k: 'wide' }
    ];

    const CHIPS = [
        { label: '🔥 Trending', q: 'trending hindi songs 2026' },
        { label: '💖 Romantic', q: 'romantic hindi songs' },
        { label: '🎶 90s Hits', q: '90s hindi songs' },
        { label: '🎤 Punjabi', q: 'latest punjabi songs' },
        { label: '😢 Sad', q: 'sad hindi songs' },
        { label: '🎉 Party', q: 'bollywood party songs' },
        { label: '🧘 Lo-fi', q: 'lofi hindi songs' },
        { label: '🙏 Devotional', q: 'bhakti songs' },
        { label: '🎸 English', q: 'english pop hits' }
    ];

    const state = {
        user: null,                // { uid, name, userId }
        currentTrack: null,
        playlist: [],
        currentIndex: -1,
        isPlaying: false,
        engine: null,              // 'yt' | 'audio' | null
        shuffle: false,
        repeat: 'off',             // 'off' | 'all' | 'one'
        shuffleHistory: [],
        shufflePlayed: new Set(),
        db: null,
        songs: new Map(),          // id -> saved song record (with audioBlob)
        playlists: [],             // [{id, name, createdAt, updatedAt, songIds:[]}]
        openPlaylistId: null,
        downloading: new Set(),
        localTracks: [],
        objectUrl: null,
        resumeAt: 0, prefs: null, radio: false, queue: [], history: [], taste: {}, recentMoods: [], speed: 1, qTab: 'next', source: '', similar: null
    };

    let ytPlayer = null, ytReady = false, ytLoading = false;
    let pendingVideoId = null, progressTimer = null, seeking = false;

    const $ = (id) => document.getElementById(id);
    const elements = {
        splash: $('splash'), authScreen: $('auth-screen'), app: $('app'),
        loginForm: $('login-form'), registerForm: $('register-form'),
        loginUserId: $('login-userid'), loginPassword: $('login-password'),
        loginError: $('login-error'), loginNotice: $('login-notice'), loginBtn: $('login-btn'),
        registerName: $('register-name'), registerUserId: $('register-userid'),
        registerPassword: $('register-password'), registerError: $('register-error'), registerBtn: $('register-btn'),
        goRegister: $('go-register'), goLogin: $('go-login'), configWarning: $('config-warning'),
        avatarBtn: $('avatar-btn'), drawer: $('side-drawer'), drawerBackdrop: $('drawer-backdrop'),
        closeDrawerBtn: $('close-drawer-btn'), drawerAvatar: $('drawer-avatar'),
        drawerName: $('drawer-name'), drawerUserId: $('drawer-userid'),
        themeToggle: $('theme-toggle'), themeIcon: $('theme-icon'), logoutBtn: $('logout-btn'),
        syncStatus: $('sync-status'), syncIcon: $('sync-icon'),
        greetingSub: $('greeting-sub'), greetingName: $('greeting-name'), chipRow: $('chip-row'),
        resultsIcon: $('results-icon'),
        audio: $('audio-engine'),
        contentArea: document.querySelector('.content-area'),
        navTabs: document.querySelectorAll('.nav-tab'),
        viewPanels: document.querySelectorAll('.view-panel'),
        searchInput: $('search-input'), clearSearchBtn: $('clear-search-btn'),
        suggestionsMenu: $('suggestions-menu'),
        resultsHeading: $('results-heading'), searchResults: $('search-results'), loadMore: $('load-more'),
        wishlistContent: $('wishlist-content'),
        localList: $('local-list'), localFileInput: $('local-file-input'),
        miniPlayer: $('mini-player'), miniThumb: $('mini-thumb'), miniTitle: $('mini-title'),
        miniArtist: $('mini-artist'), miniPlayBtn: $('mini-play-btn'), miniNextBtn: $('mini-next-btn'),
        miniProgressFill: $('mini-progress-fill'),
        fullPlayerOverlay: $('full-player-overlay'), openFullPlayerBtn: $('open-full-player-btn'),
        closePlayerBtn: $('close-player-btn'), playerBg: $('player-bg'),
        playerArtwork: $('player-artwork'), playerTitle: $('player-title'), playerArtist: $('player-artist'),
        mainPlayBtn: $('main-play-btn'), prevBtn: $('prev-btn'), nextBtn: $('next-btn'),
        back10Btn: $('back10-btn'), fwd10Btn: $('fwd10-btn'),
        shuffleBtn: $('shuffle-btn'), repeatBtn: $('repeat-btn'),
        seekBar: $('seek-bar'), currentTimeLbl: $('current-time'), totalDurationLbl: $('total-duration'),
        wishlistToggleBtn: $('wishlist-toggle-btn'),
        networkStatus: $('network-status'), toast: $('toast'),
        modalBackdrop: $('modal-backdrop'), modalSheet: $('modal-sheet')
    };
    const audio = elements.audio;
    Object.assign(elements, { shelves: $('home-shelves'), queueList: $('queue-list'), queueSource: $('queue-source'), queueChips: $('queue-chips') });

    /* ---------------------------------------------------------------------
       Helpers
       --------------------------------------------------------------------- */
    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function hashStr(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    function gradientFor(key) {
        const g = GRADS[hashStr(String(key)) % GRADS.length];
        return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
    }

    function fmtViews(n) {
        n = Number(n) || 0;
        if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
        if (n >= 1e3) return Math.round(n / 1e3) + 'K';
        return String(n);
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds == null) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    let toastTimer;
    function showToast(message, ms = 2800) {
        elements.toast.textContent = message;
        elements.toast.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), ms);
    }

    function setImg(img, src) {
        img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
        img.src = src || PLACEHOLDER;
    }

    // Tries a list of image URLs (best first) and returns the first one that really loads
    function loadBestImage(urls, cb) {
        let i = 0;
        const next = () => {
            if (i >= urls.length) { cb(PLACEHOLDER); return; }
            const url = urls[i++];
            if (!url) { next(); return; }
            const im = new Image();
            im.onload = () => { (im.naturalWidth >= 200 || i >= urls.length) ? cb(url) : next(); };
            im.onerror = next;
            im.src = url;
        };
        next();
    }

    function showMessage(container, icon, title, text = '') {
        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-rounded empty-icon">${icon}</span>
                <h3>${escapeHtml(title)}</h3>
                ${text ? `<p>${escapeHtml(text)}</p>` : ''}
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Theme (dark / light)
       --------------------------------------------------------------------- */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('sp_theme', theme); } catch (e) {}
        elements.themeToggle.checked = theme === 'dark';
        elements.themeIcon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f101c' : '#f5f5fd');
    }
    elements.themeToggle.addEventListener('change', () => applyTheme(elements.themeToggle.checked ? 'dark' : 'light'));
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    /* ---------------------------------------------------------------------
       Firebase setup
       --------------------------------------------------------------------- */
    const fbCfg = window.FIREBASE_CONFIG;
    const sdkLoaded = typeof firebase !== 'undefined';
    const configMissing = !fbCfg || !fbCfg.apiKey || /YOUR_/i.test(fbCfg.apiKey);
    let auth = null, fs = null;

    if (sdkLoaded && !configMissing) {
        try {
            firebase.initializeApp(fbCfg);
            auth = firebase.auth();
            fs = firebase.firestore();
        } catch (e) { console.error('Firebase init failed:', e); }
    }

    const emailFor = (userId) => `${userId}@${AUTH_DOMAIN}`;
    const userFromFirebase = (u) => {
        const userId = (u.email || '').split('@')[0];
        return { uid: u.uid, name: u.displayName || userId, userId };
    };

    function authErrorMessage(err) {
        switch (err && err.code) {
            case 'auth/email-already-in-use': return 'This User ID is already taken. Please try another one.';
            case 'auth/invalid-credential':
            case 'auth/invalid-login-credentials':
            case 'auth/user-not-found':
            case 'auth/wrong-password': return 'Wrong User ID or password.';
            case 'auth/weak-password': return 'Password must be at least 6 characters.';
            case 'auth/network-request-failed': return 'No internet connection. Please try again.';
            case 'auth/too-many-requests': return 'Too many attempts. Please wait a little and try again.';
            case 'auth/operation-not-allowed': return 'Email/Password sign-in is not enabled in Firebase yet (Authentication -> Sign-in method).';
            case 'auth/invalid-api-key':
            case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.': return 'Firebase keys look wrong. Check firebase-config.js.';
            default: return 'Something went wrong. ' + ((err && err.message) || '');
        }
    }

    /* ---------------------------------------------------------------------
       Login / Register screens
       --------------------------------------------------------------------- */
    let authView = 'login';
    let registering = false;

    function showAuth(view = 'login') {
        authView = view;
        elements.splash.classList.add('hidden');
        elements.app.classList.add('hidden');
        elements.authScreen.classList.remove('hidden');
        elements.loginForm.classList.toggle('hidden', view !== 'login');
        elements.registerForm.classList.toggle('hidden', view !== 'register');
        elements.loginError.classList.add('hidden');
        elements.registerError.classList.add('hidden');
        if (view === 'register') elements.loginNotice.classList.add('hidden');
        setBusy(elements.loginBtn, false, 'Log in');
        setBusy(elements.registerBtn, false, 'Register');

        let warning = '';
        if (configMissing) warning = 'Firebase is not set up yet. Open firebase-config.js and paste your Firebase keys (see the setup steps).';
        else if (!sdkLoaded) warning = 'Could not load Firebase. Please check your internet connection and refresh.';
        elements.configWarning.textContent = warning;
        elements.configWarning.classList.toggle('hidden', !warning);
    }

    function setBusy(btn, busy, label) {
        btn.disabled = busy;
        btn.querySelector('.btn-label').textContent = busy ? 'Please wait...' : label;
    }

    function showFormError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

    elements.goRegister.addEventListener('click', (e) => { e.preventDefault(); showAuth('register'); });
    elements.goLogin.addEventListener('click', (e) => { e.preventDefault(); showAuth('login'); });

    document.querySelectorAll('.eye-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = $(btn.dataset.target);
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.querySelector('span').textContent = show ? 'visibility_off' : 'visibility';
        });
    });

    elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.loginError.classList.add('hidden');
        const userId = elements.loginUserId.value.trim().toLowerCase();
        const password = elements.loginPassword.value;
        if (!userId || !password) { showFormError(elements.loginError, 'Please enter your User ID and password.'); return; }
        if (!auth) { showFormError(elements.loginError, configMissing ? 'Firebase is not set up yet (see firebase-config.js).' : 'Firebase could not load. Check your internet.'); return; }

        setBusy(elements.loginBtn, true, 'Log in');
        try {
            await auth.signInWithEmailAndPassword(emailFor(userId), password);
            // onAuthStateChanged starts the session
        } catch (err) {
            console.error(err);
            showFormError(elements.loginError, authErrorMessage(err));
            setBusy(elements.loginBtn, false, 'Log in');
        }
    });

    elements.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.registerError.classList.add('hidden');
        const name = elements.registerName.value.trim();
        const userId = elements.registerUserId.value.trim().toLowerCase();
        const password = elements.registerPassword.value;

        if (name.length < 2) { showFormError(elements.registerError, 'Please enter your name (at least 2 letters).'); return; }
        if (!/^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/.test(userId) || /\.\./.test(userId)) {
            showFormError(elements.registerError, 'User ID must be 3-20 characters: letters, numbers, "." or "_" (start and end with a letter or number).');
            return;
        }
        if (password.length < 6) { showFormError(elements.registerError, 'Password must be at least 6 characters.'); return; }
        if (!auth) { showFormError(elements.registerError, configMissing ? 'Firebase is not set up yet (see firebase-config.js).' : 'Firebase could not load. Check your internet.'); return; }

        setBusy(elements.registerBtn, true, 'Register');
        registering = true;
        try {
            const cred = await auth.createUserWithEmailAndPassword(emailFor(userId), password);
            await cred.user.updateProfile({ displayName: name });
            try {
                await fs.collection('users').doc(cred.user.uid).set({
                    name, userId, playlists: [], songs: {}, deleted: {},
                    createdAt: Date.now(), updatedAt: Date.now()
                });
            } catch (dbErr) { console.warn('Could not save profile document (check Firestore rules):', dbErr); }
            await auth.signOut();

            // go to the login page
            elements.registerForm.reset();
            showAuth('login');
            elements.loginUserId.value = userId;
            elements.loginPassword.value = '';
            elements.loginNotice.textContent = 'Account created! Please log in with your User ID and password.';
            elements.loginNotice.classList.remove('hidden');
            elements.loginPassword.focus();
        } catch (err) {
            console.error(err);
            showFormError(elements.registerError, authErrorMessage(err));
            setBusy(elements.registerBtn, false, 'Register');
        } finally {
            registering = false;
        }
    });

    /* ---------------------------------------------------------------------
       Session (start / logout)
       --------------------------------------------------------------------- */
    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
        return parts.map(p => p[0]).join('').toUpperCase() || '?';
    }

    function renderUserUI() {
        const u = state.user;
        const bg = gradientFor(u.userId);
        [elements.avatarBtn, elements.drawerAvatar].forEach(el => { el.textContent = initials(u.name); el.style.background = bg; });
        elements.drawerName.textContent = u.name;
        elements.drawerUserId.textContent = '@' + u.userId;
        renderGreeting();
    }

    function renderGreeting() {}

    async function startSession(user) {
        if (state.user && state.user.uid === user.uid) return;
        state.user = user;
        try { localStorage.setItem('sp_session', JSON.stringify(user)); } catch (e) {}

        renderUserUI();
        loadTaste(); loadPrefs();
        elements.splash.classList.add('hidden');
        elements.authScreen.classList.add('hidden');
        elements.app.classList.remove('hidden');
        setView('home-view');
        setSyncStatus(fs ? 'Checking your account...' : 'Cloud sync is off', fs ? 'cloud_sync' : 'cloud_off');

        goHome();
        if (!navigator.onLine) setView('wishlist-view');
        if (!state.prefs) setTimeout(() => { if (!state.prefs) showOnboarding(); }, 1200);

        try {
            state.db = await openDatabase('StreamPulseDB_' + user.uid);
            await refreshLibrary();
        } catch (err) {
            console.error('IndexedDB error:', err);
            showToast('Playlist storage unavailable');
        }
        await syncNow();
        retryMissingDownloads();
    }

    function resetSession() {
        state.radio = false; state.queue = []; state.history = []; state.similar = null;
        if (elements.shelves) elements.shelves.innerHTML = '';
        stopEngines();
        state.isPlaying = false;
        state.currentTrack = null;
        state.playlist = [];
        state.currentIndex = -1;
        state.shuffleHistory = [];
        state.shufflePlayed = new Set();
        elements.miniPlayer.classList.add('hidden');
        elements.fullPlayerOverlay.classList.add('hidden');
        elements.fullPlayerOverlay.classList.remove('playing');
        elements.app.classList.remove('is-playing');
        resetProgress();
        closeModal();
        closeDrawer();
        if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
        if (state.db) { try { state.db.close(); } catch (e) {} state.db = null; }
        state.songs = new Map();
        state.playlists = [];
        state.openPlaylistId = null;
        state.user = null;
        state.localTracks.forEach(t => URL.revokeObjectURL(t.streamUrl));
        state.localTracks = [];
        elements.wishlistContent.innerHTML = '';
        elements.searchInput.value = '';
        elements.clearSearchBtn.classList.add('hidden');
        elements.suggestionsMenu.classList.add('hidden');
        homeFeed.items = []; homeFeed.page = 0; homeFeed.hasMore = false; homeFeed.loading = false;
        activeFeed = homeFeed;
        elements.searchResults.innerHTML = '';
        try { localStorage.removeItem('sp_session'); } catch (e) {}
    }

    async function logout() {
        try { if (auth) await auth.signOut(); } catch (e) { console.error(e); }
        if (state.user) resetSession();
        elements.loginPassword.value = '';
        elements.loginNotice.classList.add('hidden');
        showAuth('login');
    }
    elements.logoutBtn.addEventListener('click', logout);

    /* ---------------------------------------------------------------------
       Drawer
       --------------------------------------------------------------------- */
    function openDrawer() {
        elements.drawer.classList.add('open');
        elements.drawerBackdrop.classList.add('open');
        elements.drawer.setAttribute('aria-hidden', 'false');
    }
    function closeDrawer() {
        elements.drawer.classList.remove('open');
        elements.drawerBackdrop.classList.remove('open');
        elements.drawer.setAttribute('aria-hidden', 'true');
    }
    elements.avatarBtn.addEventListener('click', openDrawer);
    elements.closeDrawerBtn.addEventListener('click', closeDrawer);
    elements.drawerBackdrop.addEventListener('click', closeDrawer);

    function setSyncStatus(text, icon) {
        elements.syncStatus.textContent = text;
        if (icon) elements.syncIcon.textContent = icon;
    }

    /* ---------------------------------------------------------------------
       Network status
       --------------------------------------------------------------------- */
    function updateNetworkStatus() {
        const online = navigator.onLine;
        elements.networkStatus.classList.toggle('offline', !online);
        elements.networkStatus.querySelector('.status-text').textContent = online ? 'Online' : 'Offline';
        if (online && state.user) {
            loadYouTubeAPI();
            if (activeFeed === homeFeed && !homeFeed.items.length) loadNextPage(homeFeed);
            syncNow().then(retryMissingDownloads);
        } else if (!online && state.user) {
            setSyncStatus('Offline - will sync when you are back online', 'cloud_off');
        }
    }
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    /* ---------------------------------------------------------------------
       YouTube IFrame player
       --------------------------------------------------------------------- */
    function loadYouTubeAPI() {
        if (ytPlayer || ytLoading) return;
        ytLoading = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.onerror = () => { ytLoading = false; tag.remove(); };
        document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = () => {
        const playerVars = { autoplay: 1, controls: 0, playsinline: 1, rel: 0, disablekb: 1 };
        if (location.protocol.startsWith('http')) playerVars.origin = location.origin;

        ytPlayer = new YT.Player('yt-audio-player', {
            height: '200', width: '200', playerVars,
            events: {
                onReady: () => {
                    ytReady = true;
                    if (pendingVideoId) { ytPlayer.loadVideoById(pendingVideoId); pendingVideoId = null; }
                },
                onStateChange: onYTStateChange,
                onError: onYTError
            }
        });
    };

    function onYTStateChange(event) {
        if (state.engine !== 'yt') return;
        if (event.data === YT.PlayerState.PLAYING) {
            state.isPlaying = true; updatePlayButtons(); startProgressTracker(); applySpeed();
                    if (state.resumeAt) { const r = state.resumeAt; state.resumeAt = 0; seekTo(r); }
        } else if (event.data === YT.PlayerState.PAUSED) {
            state.isPlaying = false; updatePlayButtons(); stopProgressTracker();
        } else if (event.data === YT.PlayerState.ENDED) {
            state.isPlaying = false; stopProgressTracker(); onTrackEnded();
        }
    }

    function onYTError(event) {
        if (state.engine !== 'yt') return;
        state.isPlaying = false;
        updatePlayButtons();
        stopProgressTracker();
        const blocked = event.data === 101 || event.data === 150;
        showToast(blocked ? 'Owner blocked this song from playing here - skipping' : 'This song cannot be played - skipping');
        setTimeout(() => { if (state.engine === 'yt') playNextTrack(); }, 1500);
    }

    function startProgressTracker() {
        stopProgressTracker();
        progressTimer = setInterval(() => {
            if (state.engine !== 'yt' || !ytReady) return;
            const total = ytPlayer.getDuration();
            if (total > 0) setProgress(ytPlayer.getCurrentTime(), total);
        }, 500);
    }

    function stopProgressTracker() {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
    }

    function setProgress(current, total) {
        if (seeking || !(total > 0)) return;
        const pct = (current / total) * 100;
        elements.seekBar.value = pct;
        elements.miniProgressFill.style.width = `${pct}%`;
        elements.currentTimeLbl.textContent = formatTime(current);
        elements.totalDurationLbl.textContent = formatTime(total);
    }

    function resetProgress() {
        elements.seekBar.value = 0;
        elements.miniProgressFill.style.width = '0%';
        elements.currentTimeLbl.textContent = '0:00';
        elements.totalDurationLbl.textContent = '0:00';
    }

    /* ---------------------------------------------------------------------
       <audio> engine (phone files + downloaded songs)
       --------------------------------------------------------------------- */
    audio.addEventListener('play', () => { if (state.engine === 'audio') { state.isPlaying = true; updatePlayButtons(); applySpeed(); if (state.resumeAt) { const r = state.resumeAt; state.resumeAt = 0; seekTo(r); } } });
    audio.addEventListener('pause', () => { if (state.engine === 'audio') { state.isPlaying = false; updatePlayButtons(); } });
    audio.addEventListener('timeupdate', () => { if (state.engine === 'audio') setProgress(audio.currentTime, audio.duration); });
    audio.addEventListener('loadedmetadata', () => {
        if (state.engine === 'audio') elements.totalDurationLbl.textContent = formatTime(audio.duration);
    });
    audio.addEventListener('ended', () => { if (state.engine === 'audio') onTrackEnded(); });
    audio.addEventListener('error', () => { if (state.engine === 'audio') showToast('Cannot play this file'); });

    /* ---------------------------------------------------------------------
       IndexedDB (one database per user on this device)
       --------------------------------------------------------------------- */
    function openDatabase(name) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('songs')) database.createObjectStore('songs', { keyPath: 'id' });
                if (!database.objectStoreNames.contains('playlists')) database.createObjectStore('playlists', { keyPath: 'id' });
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => reject(request.error);
        });
    }

    function dbRequest(storeName, mode, fn) {
        return new Promise((resolve, reject) => {
            if (!state.db) { reject(new Error('Database closed')); return; }
            const tx = state.db.transaction([storeName], mode);
            const req = fn(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    const dbAll = (s) => dbRequest(s, 'readonly', st => st.getAll());
    const dbGet = (s, id) => dbRequest(s, 'readonly', st => st.get(id));
    const dbPut = (s, rec) => dbRequest(s, 'readwrite', st => st.put(rec));
    const dbDel = (s, id) => dbRequest(s, 'readwrite', st => st.delete(id));

    async function refreshLibrary() {
        if (!state.db) return;
        const [songs, playlists] = await Promise.all([dbAll('songs'), dbAll('playlists')]);
        playlists.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        state.songs = new Map(songs.map(s => [s.id, s]));
        state.playlists = playlists;
        renderWishlistView();
        updateHearts();
        if (pickerTrack) renderPicker(pickerTrack);
    }

    const songInAnyPlaylist = (id) => state.playlists.some(p => p.songIds.includes(id));

    /* ---------------------------------------------------------------------
       Cloud sync (Firestore).  Playlists + song info follow your account.
       Audio files are downloaded separately on every device.
       --------------------------------------------------------------------- */
    const tombKey = () => 'sp_deleted_' + (state.user ? state.user.uid : '');
    function getTombstones() { try { return JSON.parse(localStorage.getItem(tombKey()) || '{}'); } catch (e) { return {}; } }
    function setTombstones(o) { try { localStorage.setItem(tombKey(), JSON.stringify(o)); } catch (e) {} }

    const songMeta = (r) => ({
        id: r.id, title: r.title || '', artist: r.artist || '', duration: r.duration || '',
        thumb: r.thumb || '', views: r.views || 0, addedAt: r.addedAt || 0
    });

    let pushTimer = null, syncing = false, syncAgain = false;

    function schedulePush() {
        if (!fs || !state.user) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(syncNow, 700);
    }

    async function syncNow() {
        if (!fs || !state.user || !state.db) return;
        if (!navigator.onLine) { setSyncStatus('Offline - will sync when you are back online', 'cloud_off'); return; }
        if (syncing) { syncAgain = true; return; }
        syncing = true;
        const uid = state.user.uid;
        setSyncStatus('Syncing...', 'cloud_sync');
        try {
            const ref = fs.collection('users').doc(uid);
            const snap = await ref.get();
            const remote = snap.exists ? snap.data() : {};
            if (remote.prefs && !state.prefs) { state.prefs = remote.prefs; try { localStorage.setItem(prefsKey(), JSON.stringify(state.prefs)); } catch (e) {} ob.classList.add('hidden'); elements.shelves.innerHTML = ''; buildShelves(); }

            // ---- merge playlists: newest edit wins, deletions are remembered ----
            const tomb = Object.assign({}, remote.deleted || {});
            const localTomb = getTombstones();
            Object.keys(localTomb).forEach(k => { tomb[k] = Math.max(tomb[k] || 0, localTomb[k]); });

            const byId = new Map();
            [...(remote.playlists || []), ...state.playlists].forEach(p => {
                const cur = byId.get(p.id);
                if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(p.id, p);
            });
            const merged = [...byId.values()].filter(p => !tomb[p.id])
                .map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt || 0, updatedAt: p.updatedAt || 0, songIds: p.songIds || [] }));

            const meta = Object.assign({}, remote.songs || {});
            state.songs.forEach(r => { meta[r.id] = songMeta(r); });

            const needed = new Set();
            merged.forEach(p => p.songIds.forEach(id => needed.add(id)));

            // ---- write the merged result into this device's database ----
            const localById = new Map(state.playlists.map(p => [p.id, p]));
            for (const p of merged) {
                const l = localById.get(p.id);
                if (!l || (l.updatedAt || 0) !== p.updatedAt || l.name !== p.name || l.songIds.join() !== p.songIds.join()) await dbPut('playlists', p);
            }
            for (const l of state.playlists) if (!byId.has(l.id) || tomb[l.id]) await dbDel('playlists', l.id);
            for (const id of needed) {
                if (!state.songs.has(id) && meta[id]) await dbPut('songs', Object.assign({}, meta[id], { audioBlob: null }));
            }
            for (const id of [...state.songs.keys()]) if (!needed.has(id)) await dbDel('songs', id);
            setTombstones(tomb);
            await refreshLibrary();

            // ---- push to the cloud ----
            const songsOut = {};
            needed.forEach(id => { if (state.songs.has(id)) songsOut[id] = songMeta(state.songs.get(id)); else if (meta[id]) songsOut[id] = meta[id]; });
            await ref.set({
                name: state.user.name, userId: state.user.userId,
                playlists: merged, songs: songsOut, deleted: tomb, updatedAt: Date.now(), prefs: state.prefs || remote.prefs || null
            }, { merge: true });
            setSyncStatus('All saved to your account', 'cloud_done');
        } catch (err) {
            console.error('Sync failed:', err);
            setSyncStatus(err && err.code === 'permission-denied' ? 'Sync blocked - check Firestore rules' : 'Sync failed - will retry', 'cloud_off');
        } finally {
            syncing = false;
            if (syncAgain) { syncAgain = false; syncNow(); }
        }
    }

    /* ---------------------------------------------------------------------
       Playlist actions
       --------------------------------------------------------------------- */
    async function createPlaylist(name) {
        const now = Date.now();
        const pl = { id: 'pl-' + now + '-' + Math.random().toString(36).slice(2, 6), name, createdAt: now, updatedAt: now, songIds: [] };
        await dbPut('playlists', pl);
        await refreshLibrary();
        schedulePush();
        return pl;
    }

    async function deletePlaylist(plId) {
        const pl = state.playlists.find(p => p.id === plId);
        if (!pl) return;
        await dbDel('playlists', plId);
        state.playlists = state.playlists.filter(p => p.id !== plId);
        for (const songId of pl.songIds) {
            if (!songInAnyPlaylist(songId)) await dbDel('songs', songId);
        }
        const tomb = getTombstones(); tomb[plId] = Date.now(); setTombstones(tomb);
        if (state.openPlaylistId === plId) state.openPlaylistId = null;
        showToast('Playlist deleted');
        await refreshLibrary();
        schedulePush();
    }

    async function addSongToPlaylist(track, plId) {
        const pl = state.playlists.find(p => p.id === plId);
        if (!pl || pl.songIds.includes(track.id)) return;

        const isNewSong = !state.songs.has(track.id);
        if (isNewSong) {
            const rec = {
                id: track.id, title: track.title, artist: track.artist,
                duration: track.duration || '', thumb: track.thumb || '', views: track.views || 0,
                addedAt: Date.now(), audioBlob: null
            };
            await dbPut('songs', rec);
            state.songs.set(rec.id, rec);
        }
        pl.songIds.push(track.id);
        pl.updatedAt = Date.now();
        await dbPut('playlists', pl);
        await refreshLibrary();
        schedulePush();
        if (isNewSong) downloadForOffline(state.songs.get(track.id));
    }

    async function removeSongFromPlaylist(songId, plId, quiet) {
        const pl = state.playlists.find(p => p.id === plId);
        if (!pl) return;
        pl.songIds = pl.songIds.filter(id => id !== songId);
        pl.updatedAt = Date.now();
        await dbPut('playlists', pl);
        if (!songInAnyPlaylist(songId)) await dbDel('songs', songId);
        if (!quiet) showToast('Removed from playlist');
        await refreshLibrary();
        schedulePush();
    }

    async function downloadForOffline(record, silent = false) {
        if (!navigator.onLine) {
            if (!silent) showToast('Added - connect to internet to download audio');
            return;
        }
        state.downloading.add(record.id);
        updateHearts();
        if (!silent) showToast('Downloading for offline...');
        try {
            const res = await fetch(`${API_BASE}/api/download?id=${encodeURIComponent(record.id)}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            if (!blob.size) throw new Error('Empty file');

            const current = await dbGet('songs', record.id);   // might have been removed meanwhile
            if (current) {
                current.audioBlob = blob;
                await dbPut('songs', current);
                if (!silent) showToast('Saved for offline listening');
            }
        } catch (err) {
            console.error('Download failed:', err);
            if (!silent) showToast('Added, but audio download failed (needs internet to play)', 4000);
        } finally {
            state.downloading.delete(record.id);
            try { await refreshLibrary(); } catch (e) {}
        }
    }

    async function retryMissingDownloads() {
        for (const rec of [...state.songs.values()]) {
            if (!state.user) return;
            if (!rec.audioBlob && !state.downloading.has(rec.id) && navigator.onLine) {
                await downloadForOffline(rec, true);
            }
        }
    }

    const isLiked = (id) => { const p = state.playlists.find(p => p.id === LIKED_ID); return !!p && p.songIds.includes(id); };
    const userPls = () => state.playlists.filter(p => p.id !== LIKED_ID);

    function updateHearts() {
        document.querySelectorAll('.heart-btn').forEach(btn => {
            const id = btn.dataset.id, icon = btn.querySelector('span');
            const dl = state.downloading.has(id), liked = isLiked(id);
            icon.classList.toggle('spin', dl);
            icon.textContent = dl ? 'progress_activity' : (liked ? 'favorite' : 'favorite_border');
            btn.classList.toggle('active', liked);
        });
        if (state.currentTrack) updateWishlistBtnState(isLiked(state.currentTrack.id));
    }

    function updateWishlistBtnState(on) {
        [elements.wishlistToggleBtn, $('mini-like-btn')].forEach(b => {
            if (!b) return;
            b.querySelector('span').textContent = on ? 'favorite' : 'favorite_border';
            b.classList.toggle('active', on);
        });
    }

    async function toggleLike(track, btn) {
        if (!track) return;
        if (track.isLocal) { showToast('Phone songs are already on your device'); return; }
        if (!state.db) return;
        if (!state.playlists.some(p => p.id === LIKED_ID)) {
            await dbPut('playlists', { id: LIKED_ID, name: 'Liked Songs', createdAt: 0, updatedAt: Date.now(), songIds: [] });
            await refreshLibrary();
        }
        if (isLiked(track.id)) { await removeSongFromPlaylist(track.id, LIKED_ID, true); showToast('Removed from Liked Songs', 1400); }
        else {
            await addSongToPlaylist(track, LIKED_ID);
            bumpMood(track._mood || detectMood(track.title + ' ' + track.artist), 3);
            burst(btn || elements.wishlistToggleBtn);
            showToast('Added to Liked Songs', 1400);
        }
    }

    /* ---------------------------------------------------------------------
       Modal sheets: create playlist / add to playlist / confirm
       --------------------------------------------------------------------- */
    let pickerTrack = null;
    let pickerBusy = false;

    function openModal(html) {
        elements.modalSheet.innerHTML = html;
        elements.modalBackdrop.classList.remove('hidden');
    }
    function closeModal() {
        pickerTrack = null;
        elements.modalBackdrop.classList.add('hidden');
        elements.modalSheet.innerHTML = '';
    }
    elements.modalBackdrop.addEventListener('click', (e) => {
        if (e.target === elements.modalBackdrop) closeModal();
    });

    function openCreatePlaylistModal(track = null) {
        pickerTrack = null;
        openModal(`
            <h3 class="modal-title">New playlist</h3>
            <input id="new-pl-name" class="modal-input" maxlength="40" placeholder="e.g. Romantic songs" autocomplete="off">
            <div class="modal-actions">
                <button class="btn-secondary" id="new-pl-cancel">Cancel</button>
                <button class="btn-primary" id="new-pl-create">Create</button>
            </div>`);
        const input = $('new-pl-name');
        setTimeout(() => input.focus(), 50);

        const submit = async () => {
            const name = input.value.trim();
            if (!name) { showToast('Enter a playlist name'); return; }
            const pl = await createPlaylist(name);
            if (track) {
                await addSongToPlaylist(track, pl.id);
                showToast(`Added to ${pl.name}`);
            }
            closeModal();
        };
        $('new-pl-create').addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        $('new-pl-cancel').addEventListener('click', () => { track ? openPicker(track) : closeModal(); });
    }

    function openPicker(track) {
        if (track.isLocal) { showToast('Phone songs are already stored on your device'); return; }
        elements.modalBackdrop.classList.remove('hidden');
        renderPicker(track);
    }

    function renderPicker(track) {
        pickerTrack = track;
        const options = userPls().length
            ? userPls().map(p => {
                const inIt = p.songIds.includes(track.id);
                return `
                <button class="pl-option" data-id="${escapeHtml(p.id)}">
                    <span class="material-symbols-rounded ${inIt ? 'checked' : ''}">${inIt ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span class="pl-name truncate">${escapeHtml(p.name)}</span>
                    <span class="pl-count">${p.songIds.length}</span>
                </button>`;
            }).join('')
            : '<p class="modal-empty">No playlists yet. Create your first one!</p>';

        elements.modalSheet.innerHTML = `
            <h3 class="modal-title">Add to playlist</h3>
            <p class="modal-sub truncate">${escapeHtml(track.title)}</p>
            <div class="pl-options">${options}</div>
            <button class="pl-new-btn" id="pl-new">+ New playlist</button>
            <div class="modal-actions"><button class="btn-primary" id="modal-done">Done</button></div>`;

        elements.modalSheet.querySelectorAll('.pl-option').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (pickerBusy) return;
                pickerBusy = true;
                try {
                    const pl = state.playlists.find(p => p.id === btn.dataset.id);
                    if (!pl) return;
                    if (pl.songIds.includes(track.id)) await removeSongFromPlaylist(track.id, pl.id);
                    else { await addSongToPlaylist(track, pl.id); showToast(`Added to ${pl.name}`); }
                } finally { pickerBusy = false; }
            });
        });
        $('pl-new').addEventListener('click', () => openCreatePlaylistModal(track));
        $('modal-done').addEventListener('click', closeModal);
    }

    function openConfirm(title, text, confirmLabel, onConfirm) {
        pickerTrack = null;
        openModal(`
            <h3 class="modal-title">${escapeHtml(title)}</h3>
            <p class="modal-text">${escapeHtml(text)}</p>
            <div class="modal-actions">
                <button class="btn-secondary" id="confirm-cancel">Cancel</button>
                <button class="btn-danger" id="confirm-ok">${escapeHtml(confirmLabel)}</button>
            </div>`);
        $('confirm-cancel').addEventListener('click', closeModal);
        $('confirm-ok').addEventListener('click', async () => { closeModal(); await onConfirm(); });
    }

    /* ---------------------------------------------------------------------
       Wishlist / Playlists page
       --------------------------------------------------------------------- */
    function coverIcon(id) { return COVER_ICONS[(hashStr(id) >> 3) % COVER_ICONS.length]; }

    function firstThumb(pl) {
        for (const id of pl.songIds) {
            const s = state.songs.get(id);
            if (s && s.thumb) return s.thumb;
        }
        return '';
    }

    function likedCard() {
        const p = state.playlists.find(p => p.id === LIKED_ID), ids = p ? p.songIds : [];
        const th = ids.slice(0, 3).map(id => state.songs.get(id)).filter(s => s && s.thumb)
            .map(s => `<img src="${escapeHtml(s.thumb)}" alt="">`).join('');
        return `<div class="liked-card" id="liked-card"><div class="liked-art"><span class="material-symbols-rounded">favorite</span></div>
            <div class="liked-text"><h3>Liked Songs</h3><p>${ids.length} song${ids.length === 1 ? '' : 's'} you loved</p></div><div class="liked-thumbs">${th}</div></div>`;
    }

    function renderWishlistView() {
        const root = elements.wishlistContent;
        const open = state.playlists.find(p => p.id === state.openPlaylistId);
        if (open) { renderPlaylistDetail(root, open); return; }
        state.openPlaylistId = null;

        root.innerHTML = `
            <div class="page-hero hero-pink">
                <div class="hero-icon"><span class="material-symbols-rounded">library_music</span></div>
                <div class="hero-copy">
                    <h2>Your Library</h2>
                    <p>Saved offline and synced to your account</p>
                </div>
                <button class="btn-light" id="new-playlist-btn" style="position:relative;z-index:1">
                    <span class="material-symbols-rounded">add</span><span>New</span>
                </button>
            </div>
            ${likedCard()}
            <h3 class="section-heading"><span class="material-symbols-rounded">library_music</span>Playlists</h3>
            <div id="playlist-grid" class="pl-grid"></div>`;
        $('new-playlist-btn').addEventListener('click', () => openCreatePlaylistModal());
        $('liked-card').addEventListener('click', () => {
            if (!state.playlists.some(p => p.id === LIKED_ID)) { showToast('Tap the heart on any song to like it'); return; }
            state.openPlaylistId = LIKED_ID; renderWishlistView();
        });

        const grid = $('playlist-grid');
        const tiles = userPls().map(p => {
            const thumb = firstThumb(p);
            return `
            <div class="pl-tile" data-id="${escapeHtml(p.id)}">
                <div class="pl-cover" style="background:${gradientFor(p.id)}">
                    <span class="material-symbols-rounded pl-cover-icon">${coverIcon(p.id)}</span>
                    ${thumb ? `<img class="pl-cover-img" alt="" data-src="${escapeHtml(thumb)}">` : ''}
                    <button class="icon-btn tile-del" aria-label="Delete playlist"><span class="material-symbols-rounded">delete</span></button>
                </div>
                <div class="pl-tile-name truncate">${escapeHtml(p.name)}</div>
                <div class="pl-tile-count">${p.songIds.length} song${p.songIds.length === 1 ? '' : 's'}</div>
            </div>`;
        }).join('');

        grid.innerHTML = tiles + `
            <div class="pl-tile new" id="new-tile">
                <div class="pl-cover"><span class="material-symbols-rounded pl-cover-icon">add</span></div>
                <div class="pl-tile-name">New playlist</div>
                <div class="pl-tile-count">Romantic, Gym, Road trip...</div>
            </div>`;

        $('new-tile').addEventListener('click', () => openCreatePlaylistModal());

        grid.querySelectorAll('.pl-tile[data-id]').forEach(tile => {
            const id = tile.dataset.id;
            const img = tile.querySelector('.pl-cover-img');
            if (img) { img.onerror = () => img.remove(); img.src = img.dataset.src; }
            tile.addEventListener('click', () => {
                state.openPlaylistId = id;
                renderWishlistView();
                elements.contentArea.scrollTop = 0;
            });
            tile.querySelector('.tile-del').addEventListener('click', (e) => {
                e.stopPropagation();
                const pl = state.playlists.find(p => p.id === id);
                openConfirm('Delete playlist?', `"${pl.name}" will be deleted. Songs that are not in any other playlist are removed from offline storage.`,
                    'Delete', () => deletePlaylist(id));
            });
        });
    }

    function renderPlaylistDetail(root, pl) {
        const songs = pl.songIds.map(id => state.songs.get(id)).filter(Boolean);
        const thumb = firstThumb(pl);
        root.innerHTML = `
            <div class="pl-hero" style="background:${gradientFor(pl.id)}">
                <button class="icon-btn" id="back-to-playlists" aria-label="Back"><span class="material-symbols-rounded">arrow_back</span></button>
                <div class="pl-hero-body">
                    <div class="pl-hero-cover">
                        <span class="material-symbols-rounded">${coverIcon(pl.id)}</span>
                        ${thumb ? `<img alt="" id="pl-hero-img">` : ''}
                    </div>
                    <div class="pl-hero-text">
                        <p class="pl-hero-label">PLAYLIST</p>
                        <h2>${escapeHtml(pl.name)}</h2>
                        <p class="pl-hero-count">${songs.length} song${songs.length === 1 ? '' : 's'}</p>
                    </div>
                </div>
                ${songs.length ? `
                <div class="pl-hero-actions">
                    <button class="btn-white" id="play-all-btn"><span class="material-symbols-rounded">play_arrow</span><span>Play all</span></button>
                    <button class="btn-glass" id="shuffle-play-btn"><span class="material-symbols-rounded">shuffle</span><span>Shuffle</span></button>
                </div>` : ''}
            </div>
            <div id="playlist-songs" class="song-list"></div>`;

        const heroImg = $('pl-hero-img');
        if (heroImg) { heroImg.onerror = () => heroImg.remove(); heroImg.src = thumb; }

        $('back-to-playlists').addEventListener('click', () => { state.openPlaylistId = null; renderWishlistView(); });
        const playAll = $('play-all-btn');
        if (playAll) playAll.addEventListener('click', () => { setShuffle(false); playTrack(songs[0], songs); });
        const shufflePlay = $('shuffle-play-btn');
        if (shufflePlay) shufflePlay.addEventListener('click', () => {
            setShuffle(true);
            playTrack(songs[Math.floor(Math.random() * songs.length)], songs);
        });

        renderSongList(songs, $('playlist-songs'), {
            remove: true,
            onRemove: (track) => removeSongFromPlaylist(track.id, pl.id),
            emptyIcon: 'library_music',
            emptyTitle: 'This playlist is empty',
            emptyText: 'Search songs on Home and tap the heart to add them here.'
        });
    }

    /* ---------------------------------------------------------------------
       Navigation
       --------------------------------------------------------------------- */
    function setView(viewId) {
        elements.app.dataset.view = viewId.replace('-view', '');
        elements.navTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-target') === viewId));
        elements.viewPanels.forEach(p => p.classList.toggle('active', p.id === viewId));
        elements.contentArea.scrollTop = 0;
        if (viewId === 'search-view' && window.innerWidth >= 900) setTimeout(() => elements.searchInput.focus(), 60);
    }
    elements.navTabs.forEach(tab => tab.addEventListener('click', () => setView(tab.getAttribute('data-target'))));

    /* ---------------------------------------------------------------------
       Home feed + search with infinite scroll (20 songs per page)
       --------------------------------------------------------------------- */
    const newFeed = (query) => ({ query, items: [], page: 0, hasMore: true, loading: false });
    const homeFeed = newFeed(HOME_QUERY);
    homeFeed.hasMore = false;   // home is now shelves; the infinite list lives in the Search tab
    let activeFeed = homeFeed;

    const observer = new IntersectionObserver((entries) => {
        if (state.user && entries.some(e => e.isIntersecting)) loadNextPage(activeFeed);
    }, { root: elements.contentArea, rootMargin: '400px' });
    observer.observe(elements.loadMore);

    function rearmObserver() {
        observer.unobserve(elements.loadMore);
        observer.observe(elements.loadMore);
    }

    async function loadNextPage(feed) {
        if (feed.loading || !feed.hasMore || !state.user) return;
        const isHome = feed === homeFeed;
        const firstPage = feed.page === 0;

        if (!navigator.onLine) {
            if (firstPage && feed === activeFeed) {
                showMessage(elements.searchResults, 'wifi_off', 'You are offline', 'Open the Library tab to play your downloaded songs.');
            }
            return;
        }

        feed.loading = true;
        if (feed === activeFeed) {
            if (firstPage) elements.searchResults.innerHTML = '<div class="sk-row"></div>'.repeat(8);
            else elements.loadMore.textContent = 'Loading more...';
        }

        let ok = false;
        try {
            const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(feed.query)}&page=${feed.page + 1}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            const known = new Set(feed.items.map(i => i.id));
            const fresh = (data.items || []).filter(i => !known.has(i.id));
            const startIndex = feed.items.length;
            feed.items.push(...fresh);
            feed.page += 1;
            feed.hasMore = !!data.hasMore && (data.items || []).length > 0;
            ok = true;

            if (feed === activeFeed && state.user) {
                renderSongList(feed.items, elements.searchResults, {
                    heart: true,
                    startIndex: firstPage ? 0 : startIndex,
                    emptyIcon: 'search_off',
                    emptyTitle: 'No songs found',
                    emptyText: 'Try a different spelling or another name.'
                });
            }
        } catch (err) {
            console.error(err);
            if (feed === activeFeed) {
                if (firstPage) showMessage(elements.searchResults, 'error', 'Failed to fetch results', 'Is the backend running? (node server.js)');
                else showToast('Could not load more songs');
            }
        } finally {
            feed.loading = false;
            if (feed === activeFeed) {
                elements.loadMore.textContent = '';
                if (ok) rearmObserver();
            }
        }
    }

    function setHeading(text, icon) {
        elements.resultsHeading.textContent = text;
        elements.resultsIcon.textContent = icon;
    }

    function setActiveChip(query) {
        elements.chipRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.q === query));
    }

    function goHome() {
        activeFeed = { query: '', items: [], page: 0, hasMore: false, loading: false };
        $('browse-grid').classList.remove('hidden'); $('results-head').classList.add('hidden');
        elements.searchResults.innerHTML = ''; elements.loadMore.textContent = '';
        setActiveChip('');
        if (!elements.shelves.children.length) buildShelves();
    }

    function executeSearch(query) {
        if (!query) { goHome(); return; }
        activeFeed = newFeed(query);
        activeFeed.mood = detectMood(query);
        $('browse-grid').classList.add('hidden'); $('results-head').classList.remove('hidden');
        setHeading(`Results for “${query}”`, 'search');
        setActiveChip(query);
        elements.contentArea.scrollTop = 0;
        elements.loadMore.textContent = '';
        loadNextPage(activeFeed);
    }

    // Quick category chips
    elements.chipRow.innerHTML = CHIPS.map((c, i) =>
        `<button class="chip" data-q="${escapeHtml(c.q)}">${escapeHtml(c.label)}</button>`).join('');
    elements.chipRow.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const q = chip.dataset.q;
        if (!q) {
            elements.searchInput.value = '';
            elements.clearSearchBtn.classList.add('hidden');
            goHome();
        } else {
            elements.searchInput.value = q;
            elements.clearSearchBtn.classList.remove('hidden');
            executeSearch(q);
        }
    });

    /* ---------------------------------------------------------------------
       Search box + suggestions
       --------------------------------------------------------------------- */
    let debounceTimer;
    elements.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        elements.clearSearchBtn.classList.toggle('hidden', query === '');
        clearTimeout(debounceTimer);
        if (query.length < 2) {
            elements.suggestionsMenu.classList.add('hidden');
            if (query === '' && activeFeed !== homeFeed) goHome();
            return;
        }
        debounceTimer = setTimeout(() => fetchSearchSuggestions(query), 250);
    });

    // The X button: clear the search and go back to the latest songs
    elements.clearSearchBtn.addEventListener('click', () => {
        elements.searchInput.value = '';
        elements.clearSearchBtn.classList.add('hidden');
        elements.suggestionsMenu.classList.add('hidden');
        goHome();
    });

    async function fetchSearchSuggestions(query) {
        try {
            const res = await fetch(`${API_BASE}/api/suggest?q=${encodeURIComponent(query)}`);
            const list = await res.json();
            if (elements.searchInput.value.trim() !== query) return;
            renderSuggestions(list);
        } catch (err) {
            elements.suggestionsMenu.classList.add('hidden');
        }
    }

    function renderSuggestions(suggestions) {
        if (!suggestions.length) { elements.suggestionsMenu.classList.add('hidden'); return; }
        elements.suggestionsMenu.innerHTML = suggestions.map(text => `
            <li class="suggestion-item" data-query="${escapeHtml(text)}">
                <span class="material-symbols-rounded">search</span>
                <span>${escapeHtml(text)}</span>
            </li>`).join('');
        elements.suggestionsMenu.classList.remove('hidden');
    }

    elements.suggestionsMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        const q = item.getAttribute('data-query');
        elements.searchInput.value = q;
        elements.clearSearchBtn.classList.remove('hidden');
        elements.suggestionsMenu.classList.add('hidden');
        executeSearch(q);
    });

    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(debounceTimer);
            elements.suggestionsMenu.classList.add('hidden');
            executeSearch(elements.searchInput.value.trim());
            elements.searchInput.blur();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box-container')) elements.suggestionsMenu.classList.add('hidden');
    });

    /* ---------------------------------------------------------------------
       Song list rendering (supports appending for infinite scroll)
       --------------------------------------------------------------------- */
    function cardHTML(s, i, opts) {
        const saved = state.songs.get(s.id);
        const offline = s.audioBlob || (saved && saved.audioBlob);
        return `
            <div class="song-card" data-index="${i}" data-track-id="${escapeHtml(s.id)}">
                <div class="song-info">
                    <div class="thumb-wrap">
                        <img class="song-thumb" alt="">
                        <span class="eq"><i></i><i></i><i></i></span>
                    </div>
                    <div class="song-details">
                        <span class="song-title truncate">${escapeHtml(s.title)}</span>
                        <span class="song-artist truncate">${escapeHtml(s.artist)}${viewsHTML(s.views)}${s.duration ? ' • ' + escapeHtml(s.duration) : ''}${offline ? ' • Offline ✓' : ''}</span>
                    </div>
                </div>
                ${opts.heart ? `
                <div class="song-actions">
                    <button class="icon-btn heart-btn" data-id="${escapeHtml(s.id)}" aria-label="Like">
                        <span class="material-symbols-rounded">favorite_border</span>
                    </button>
                    <button class="icon-btn add-btn" aria-label="Add to playlist">
                        <span class="material-symbols-rounded">playlist_add</span>
                    </button>
                </div>` : ''}
                ${opts.remove ? `
                <div class="song-actions">
                    <button class="icon-btn remove-btn" aria-label="Remove from playlist">
                        <span class="material-symbols-rounded">remove_circle_outline</span>
                    </button>
                </div>` : ''}
            </div>`;
    }

    function renderSongList(songs, container, opts = {}) {
        const start = opts.startIndex || 0;
        if (!songs.length) {
            showMessage(container, opts.emptyIcon || 'queue_music', opts.emptyTitle || 'No Songs Found', opts.emptyText || '');
            return;
        }

        const html = songs.slice(start).map((s, k) => cardHTML(s, start + k, opts)).join('');
        if (start > 0) container.insertAdjacentHTML('beforeend', html);
        else container.innerHTML = html;

        container.querySelectorAll('.song-card').forEach(card => {
            const i = Number(card.dataset.index);
            if (i < start) return;
            const track = songs[i];
            setImg(card.querySelector('.song-thumb'), track.thumb);
            card.querySelector('.song-info').addEventListener('click', () => {
                if (opts.queue) playQueued(track, opts.queue);
                else playTrack(track, songs, { radio: !!opts.heart, mood: opts.mood || (activeFeed && activeFeed.mood) || null });
            });

            const heart = card.querySelector('.heart-btn');
            if (heart) heart.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(track, heart); });
            const addB = card.querySelector('.add-btn');
            if (addB) addB.addEventListener('click', (e) => { e.stopPropagation(); openPicker(track); });

            const rm = card.querySelector('.remove-btn');
            if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove && opts.onRemove(track); });
        });

        updateHearts();
        markNowPlaying();
    }

    function markNowPlaying() {
        const id = state.currentTrack && state.currentTrack.id;
        document.querySelectorAll('.song-card[data-track-id]').forEach(c => c.classList.toggle('now-playing', c.dataset.trackId === id));
    }

    /* ---------------------------------------------------------------------
       Playback controller  (shuffle, repeat, +/-10s)
       --------------------------------------------------------------------- */
    function stopEngines() {
        state.engine = null;
        stopProgressTracker();
        audio.pause();
        if (ytReady) { try { ytPlayer.stopVideo(); } catch (e) {} }
        pendingVideoId = null;
    }

    function playTrack(track, playlistContext = [], opts = {}) {
        state.radio = !!opts.radio;
        if (state.radio && !opts.keep) { state.queue = []; state.history = []; state.similar = null; setTimeout(refillRadio, 0); }
        if (state.radio && state.currentTrack && state.currentTrack.id !== track.id && !opts.back) {
            state.history.push(state.currentTrack); if (state.history.length > 60) state.history.shift();
        }
        state.resumeAt = opts.resumeAt || 0;
        recTouch(track, opts.resumeAt || 0);
        const mood = opts.mood || track._mood || detectMood(track.title + ' ' + track.artist);
        track._mood = mood;
        if (mood) { state.recentMoods.push(mood); if (state.recentMoods.length > 12) state.recentMoods.shift(); bumpMood(mood, 1); }
        // a new list started -> forget shuffle history
        if (playlistContext.length && playlistContext !== state.playlist) {
            state.shuffleHistory = [];
            state.shufflePlayed = new Set();
        }
        state.currentTrack = track;
        state.playlist = playlistContext.length ? playlistContext : [track];
        state.currentIndex = state.playlist.findIndex(t => t.id === track.id);
        state.shufflePlayed.add(track.id);

        const saved = state.songs.get(track.id);
        const blob = track.audioBlob || (saved && saved.audioBlob);

        if (!track.isLocal && !blob && !navigator.onLine) {
            showToast('You are offline and this song is not downloaded');
            return;
        }

        stopEngines();
        resetProgress();
        state.isPlaying = false;
        updateTrackUI();
        updatePlayButtons();

        if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }

        if (track.isLocal || blob) {
            state.engine = 'audio';
            if (blob) state.objectUrl = URL.createObjectURL(blob);
            audio.src = blob ? state.objectUrl : track.streamUrl;
            audio.play().catch(err => { console.error(err); showToast('Tap play to start'); });
        } else {
            state.engine = 'yt';
            if (ytReady) {
                ytPlayer.loadVideoById(track.id);
                ytPlayer.setVolume(100);
                ytPlayer.unMute();
            } else {
                pendingVideoId = track.id;
                loadYouTubeAPI();
                showToast('Loading player...');
            }
        }
        setupMediaSession(track);
    }

    function pauseCurrent() {
        if (state.engine === 'audio') audio.pause();
        else if (state.engine === 'yt' && ytReady) ytPlayer.pauseVideo();
    }
    function resumeCurrent() {
        if (state.engine === 'audio') audio.play().catch(() => {});
        else if (state.engine === 'yt' && ytReady) ytPlayer.playVideo();
    }
    function togglePlayPause() {
        if (!state.currentTrack) return;
        if (state.isPlaying) pauseCurrent(); else resumeCurrent();
    }

    function pickShuffleIndex() {
        const n = state.playlist.length;
        const cur = state.currentIndex;
        let cands = [];
        for (let i = 0; i < n; i++) if (i !== cur && !state.shufflePlayed.has(state.playlist[i].id)) cands.push(i);
        if (!cands.length) {                      // everything played once -> start a new round
            state.shufflePlayed = new Set(state.currentTrack ? [state.currentTrack.id] : []);
            for (let i = 0; i < n; i++) if (i !== cur) cands.push(i);
        }
        return cands.length ? cands[Math.floor(Math.random() * cands.length)] : -1;
    }

    async function playNextTrack() {
        if (!navigator.onLine) {
            const ok = (t) => t.isLocal || t.audioBlob || (state.songs.get(t.id) || {}).audioBlob;
            const pool = (state.radio || state.playlist.length < 2) ? [...state.songs.values()].filter(ok) : state.playlist;
            const cur = state.currentTrack, idx = pool.findIndex(t => cur && t.id === cur.id);
            for (let k = 1; k <= pool.length; k++) {
                const t = pool[(idx + k) % pool.length];
                if ((!cur || t.id !== cur.id) && ok(t)) { playTrack(t, pool, {}); return; }
            }
            showToast('No more downloaded songs');
            return;
        }
        if (state.radio) {
            const pos = currentPosition();
            if (state.currentTrack && pos > 0.1 && pos < 8) bumpMood(state.currentTrack._mood, -1);   // skipped early = not your taste
            if (!state.queue.length) { showToast('Finding songs you will like...', 1500); await refillRadio(); }
            const n = state.queue.shift();
            if (n) { playTrack(n, [], { radio: true, keep: true }); if (state.queue.length < 4) refillRadio(); return; }
        }
        if (!state.playlist.length) return;

        if (state.shuffle && state.playlist.length > 1) {
            const idx = pickShuffleIndex();
            if (idx >= 0) {
                if (state.currentTrack) state.shuffleHistory.push(state.currentTrack.id);
                playTrack(state.playlist[idx], state.playlist);
                return;
            }
        }
        if (state.currentIndex < state.playlist.length - 1) {
            playTrack(state.playlist[state.currentIndex + 1], state.playlist);
        } else if (state.repeat === 'all' && state.playlist.length) {
            playTrack(state.playlist[0], state.playlist);
        } else {
            state.isPlaying = false;
            updatePlayButtons();
        }
    }

    function playPrevTrack() {
        if (state.radio && currentPosition() <= 3 && state.history.length) {
            const p = state.history.pop();
            if (state.currentTrack) state.queue.unshift(state.currentTrack);
            playTrack(p, [], { radio: true, keep: true, back: true });
            return;
        }
        const pos = state.engine === 'audio' ? audio.currentTime
                  : (state.engine === 'yt' && ytReady ? ytPlayer.getCurrentTime() : 0);
        if (pos > 3) { seekTo(0); return; }                // restart current song first

        if (state.shuffle && state.shuffleHistory.length) {
            const id = state.shuffleHistory.pop();
            const t = state.playlist.find(x => x.id === id);
            if (t) { playTrack(t, state.playlist); return; }
        }
        if (state.currentIndex > 0) playTrack(state.playlist[state.currentIndex - 1], state.playlist);
    }

    function onTrackEnded() {
        if (state.repeat === 'one') { seekTo(0); resumeCurrent(); return; }
        playNextTrack();
    }

    function currentDuration() {
        if (state.engine === 'audio') return audio.duration;
        if (state.engine === 'yt' && ytReady) return ytPlayer.getDuration();
        return 0;
    }
    function currentPosition() {
        if (state.engine === 'audio') return audio.currentTime;
        if (state.engine === 'yt' && ytReady) return ytPlayer.getCurrentTime();
        return 0;
    }
    function seekTo(seconds) {
        if (state.engine === 'audio') audio.currentTime = seconds;
        else if (state.engine === 'yt' && ytReady) ytPlayer.seekTo(seconds, true);
        const total = currentDuration();
        if (total > 0) setProgress(seconds, total);
    }
    function skipBy(seconds) {
        const total = currentDuration();
        if (!(total > 0)) return;
        seekTo(Math.min(Math.max(currentPosition() + seconds, 0), Math.max(total - 0.5, 0)));
    }

    function setShuffle(on) {
        state.shuffle = on;
        elements.shuffleBtn.classList.toggle('active', on);
        if (on) showToast('Shuffle on', 1400);
    }

    function cycleRepeat() {
        state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
        const icon = elements.repeatBtn.querySelector('span');
        icon.textContent = state.repeat === 'one' ? 'repeat_one' : 'repeat';
        elements.repeatBtn.classList.toggle('active', state.repeat !== 'off');
        showToast(state.repeat === 'off' ? 'Repeat off' : state.repeat === 'all' ? 'Repeat all' : 'Repeat this song', 1400);
    }

    /* ---------------------------------------------------------------------
       Player UI
       --------------------------------------------------------------------- */
    let artToken = 0;
    function updatePlayerArt(t) {
        const token = ++artToken;
        const isYT = !t.isLocal && /^[\w-]{11}$/.test(t.id);
        const urls = isYT
            ? [`https://i.ytimg.com/vi/${t.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`, t.thumb]
            : [t.thumb];
        setImg(elements.playerArtwork, t.thumb);            // instant low-res, then swap to HD
        elements.playerBg.style.backgroundImage = '';
        loadBestImage(urls, (url) => {
            if (token !== artToken) return;
            elements.playerArtwork.src = url;
            if (url !== PLACEHOLDER) elements.playerBg.style.backgroundImage = `url("${url}")`;
        });
    }

    function updateTrackUI() {
        const t = state.currentTrack;
        if (!t) return;
        setImg(elements.miniThumb, t.thumb);
        elements.miniTitle.textContent = t.title;
        elements.miniArtist.textContent = t.artist;
        elements.playerTitle.textContent = t.title;
        elements.playerArtist.innerHTML = escapeHtml(t.artist) + viewsHTML(t.views);
        elements.miniPlayer.classList.remove('hidden');
        updatePlayerArt(t);
        updateWishlistBtnState(isLiked(t.id));
        setWaveColors(t);
        if (state.qTab === 'similar') { state.similar = null; loadSimilar(); }
        renderQueue();
        markNowPlaying();
    }

    function updatePlayButtons() {
        const icon = state.isPlaying ? 'pause' : 'play_arrow';
        elements.mainPlayBtn.querySelector('span').textContent = icon;
        elements.miniPlayBtn.querySelector('span').textContent = icon;
        elements.fullPlayerOverlay.classList.toggle('playing', state.isPlaying);
        elements.app.classList.toggle('is-playing', state.isPlaying);
    }

    function setupMediaSession(track) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            artwork: track.thumb ? [{ src: track.thumb, sizes: '320x180' }] : []
        });
        const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) {} };
        set('play', resumeCurrent);
        set('pause', pauseCurrent);
        set('previoustrack', playPrevTrack);
        set('nexttrack', playNextTrack);
        set('seekbackward', () => skipBy(-10));
        set('seekforward', () => skipBy(10));
    }

    /* ---------------------------------------------------------------------
       Taste profile + recommendations (so "next" follows what you like)
       --------------------------------------------------------------------- */
    const tasteKey = () => 'sp_taste_' + (state.user ? state.user.uid : '');
    function loadTaste() {
        try { const t = JSON.parse(localStorage.getItem(tasteKey()) || '{}'); state.taste = t.m || {}; state.recentMoods = t.r || []; }
        catch (e) { state.taste = {}; state.recentMoods = []; }
    }
    function saveTaste() { try { localStorage.setItem(tasteKey(), JSON.stringify({ m: state.taste, r: state.recentMoods.slice(-12) })); } catch (e) {} }
    function bumpMood(m, n) { if (!m || !MOODS[m]) return; state.taste[m] = Math.max(0, (state.taste[m] || 0) + n); saveTaste(); }

    function moodScores() {
        const sc = {}, r = state.recentMoods.slice(-8);
        r.forEach((m, i) => { sc[m] = (sc[m] || 0) + 0.6 + 0.4 * (i + 1) / r.length; });      // recent plays count most
        Object.keys(state.taste).forEach(m => { sc[m] = (sc[m] || 0) + Math.min(state.taste[m], 20) * 0.08; });
        state.songs.forEach(s => { if (isLiked(s.id)) { const m = detectMood(s.title + ' ' + s.artist); if (m) sc[m] = (sc[m] || 0) + 0.25; } });
        return Object.entries(sc).sort((a, b) => b[1] - a[1]);
    }
    const topMood = () => { const s = moodScores(); return s.length && s[0][1] > 0.5 ? s[0][0] : null; };
    function pickMood() {
        const s = moodScores();
        if (!s.length) return null;
        return (s[1] && s[1][1] > s[0][1] * 0.6 && Math.random() < 0.15) ? s[1][0] : s[0][0];   // 15% variety
    }

    let refilling = false;
    async function refillRadio() {
        if (!state.radio || refilling) return;
        refilling = true;
        try {
            const m = pickMood(); let q;
            if (m) q = moodQuery(m);
            else { const a = state.currentTrack && state.currentTrack.artist; q = (a && a !== 'YouTube' && !/music|records|t-series/i.test(a)) ? a + ' songs' : HOME_QUERY; }
            const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&page=${Math.random() < 0.3 ? 2 : 1}`);
            const d = await res.json();
            const seen = new Set([...state.history, ...state.queue, state.currentTrack].filter(Boolean).map(x => x.id));
            const fresh = (d.items || []).filter(i => !seen.has(i.id)).sort(() => Math.random() - 0.5).slice(0, 10);
            fresh.forEach(i => { i._mood = m; });
            state.queue.push(...fresh);
            state.source = m ? `${MOODS[m].e} ${MOODS[m].label} mix` : 'Your mix';
        } catch (e) { console.error('refill failed', e); }
        finally { refilling = false; renderQueue(); }
    }

    async function loadSimilar() {
        const t = state.currentTrack; if (!t) return;
        const m = t._mood; const q = m ? moodQuery(m) : (t.artist + ' songs');
        try {
            const d = await (await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&page=1`)).json();
            state.similar = (d.items || []).filter(i => i.id !== t.id).slice(0, 15);
            state.similar.forEach(i => { i._mood = m; });
        } catch (e) { state.similar = []; }
        renderQueue();
    }

    function playQueued(track, tab) {
        if (tab === 'next' && state.radio) {
            const i = state.queue.findIndex(x => x.id === track.id);
            state.queue = state.queue.slice(i + 1);
            playTrack(track, [], { radio: true, keep: true });
        } else if (tab === 'next') playTrack(track, state.playlist);
        else playTrack(track, [], { radio: true, mood: track._mood });
    }

    function renderQueue() {
        if (!elements.queueList) return;
        const t = state.qTab; let items;
        if (t === 'played') items = [...state.history].reverse();
        else if (t === 'similar') items = state.similar || [];
        else items = state.radio ? state.queue : state.playlist.slice(state.currentIndex + 1);
        elements.queueSource.textContent = state.radio ? (state.source || 'Your mix') : (state.playlist.length > 1 ? 'Playlist' : 'Single song');
        if (!items.length) { showMessage(elements.queueList, 'queue_music', t === 'similar' && !state.similar ? 'Finding similar songs...' : 'Nothing here yet', t === 'next' ? 'More songs load as you listen.' : ''); return; }
        renderSongList(items.slice(0, 40), elements.queueList, { queue: t });
    }

    /* ---------------------------------------------------------------------
       Views icon, recent plays (resume), arrange home sections
       --------------------------------------------------------------------- */
    function viewsHTML(n) {
        return n ? ` • <span class="eye"><span class="material-symbols-rounded">visibility</span>${fmtViews(n)}</span>` : '';
    }
    const recKey = () => 'sp_recent_' + (state.user ? state.user.uid : '');
    const recLoad = () => { try { return JSON.parse(localStorage.getItem(recKey()) || '[]'); } catch (e) { return []; } };
    const recSave = (l) => { try { localStorage.setItem(recKey(), JSON.stringify(l.slice(0, 20))); } catch (e) {} };
    function parseDur(s) { return s ? String(s).split(':').reduce((a, b) => a * 60 + (Number(b) || 0), 0) : 0; }
    function fmtListen(s) {
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
        return h ? `${h} hr ${m} min` : m ? `${m} min ${x} sec` : `${x} sec`;
    }
    function recTouch(track, pos) {
        if (!track || track.isLocal || !state.user) return;
        const l = recLoad(), old = l.find(x => x.id === track.id);
        const live = state.currentTrack && state.currentTrack.id === track.id ? currentDuration() : 0;
        const dur = Math.floor(live > 0 ? live : ((old && old.dur) || parseDur(track.duration)));
        recSave([{ id: track.id, title: track.title, artist: track.artist, thumb: track.thumb, duration: track.duration, views: track.views || 0, mood: track._mood || null, pos: Math.floor(pos || 0), dur, t: Date.now() }, ...l.filter(x => x.id !== track.id)]);
    }
    const recNow = () => { if (state.currentTrack && state.isPlaying) { const p = currentPosition(); if (p > 0) recTouch(state.currentTrack, p); } };
    setInterval(recNow, 3000);
    window.addEventListener('pagehide', recNow);

    function renderRecent() {
        const l = recLoad(), box = $('recent-list');
        if (!l.length) { showMessage(box, 'history', 'Nothing played yet', 'Songs you listen to will appear here.'); return; }
        box.innerHTML = l.map((r, i) => {
            const pct = r.dur > 0 ? Math.min(100, r.pos / r.dur * 100) : 0;
            return `<button class="recent-item" data-i="${i}"><span class="rc-img"><img data-src="${escapeHtml(r.thumb || '')}" alt=""><i class="rc-bar" style="width:${pct}%"></i></span>
                <span class="rc-t"><strong class="truncate">${escapeHtml(r.title)}</strong><small class="truncate">${escapeHtml(r.artist)}${viewsHTML(r.views)}</small>
                <small class="rc-time">Played for ${fmtListen(r.pos)}${r.dur ? ' of ' + fmtListen(r.dur) : ''}</small></span>
                <span class="material-symbols-rounded">play_arrow</span></button>`;
        }).join('');
        box.querySelectorAll('img[data-src]').forEach(im => setImg(im, im.dataset.src));
        box.querySelectorAll('.recent-item').forEach(b => b.addEventListener('click', () => {
            const r = l[+b.dataset.i], at = r.dur && r.pos >= r.dur - 3 ? 0 : r.pos;
            playTrack({ id: r.id, title: r.title, artist: r.artist, thumb: r.thumb, duration: r.duration, views: r.views, _mood: r.mood }, [], { radio: true, mood: r.mood, resumeAt: at });
        }));
    }
    $('recent-btn').addEventListener('click', () => { renderRecent(); setView('recent-view'); });
    $('recent-back').addEventListener('click', () => setView('home-view'));
    $('recent-clear').addEventListener('click', () => { recSave([]); renderRecent(); });

    const shelfKey = (s) => s.t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const orderKey = () => 'sp_order_' + (state.user ? state.user.uid : '');
    const hiddenKey = () => 'sp_hidden_' + (state.user ? state.user.uid : '');
    function rebuildHome() { elements.shelves.innerHTML = ''; buildShelves(); elements.contentArea.scrollTop = 0; }
    function openArrange() {
        const hid = JSON.parse(localStorage.getItem(hiddenKey()) || '[]');
        openModal(`<h3 class="modal-title">Arrange Home</h3>
            <p class="modal-sub">Drag the handle or use the arrows. The top one shows first. The eye hides a section.</p>
            <ul id="arr-list" class="arr-list">${allShelves.map(s => { const k = shelfKey(s), off = hid.includes(k); return `<li data-k="${k}" class="${off ? 'off' : ''}"><span class="material-symbols-rounded drag-h">drag_indicator</span><span class="arr-t">${escapeHtml(s.t)}</span><button class="icon-btn arr-up" aria-label="Move up"><span class="material-symbols-rounded">keyboard_arrow_up</span></button><button class="icon-btn arr-dn" aria-label="Move down"><span class="material-symbols-rounded">keyboard_arrow_down</span></button><button class="icon-btn arr-eye" aria-label="Show or hide"><span class="material-symbols-rounded">${off ? 'visibility_off' : 'visibility'}</span></button></li>`; }).join('')}</ul>
            <div class="modal-actions"><button class="btn-secondary" id="arr-reset">Reset</button><button class="btn-primary" id="arr-save">Done</button></div>`);
        const list = $('arr-list');
        list.addEventListener('click', (e) => {
            const li = e.target.closest('li'); if (!li) return;
            if (e.target.closest('.arr-up') && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
            else if (e.target.closest('.arr-dn') && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
            else if (e.target.closest('.arr-eye')) { li.classList.toggle('off'); li.querySelector('.arr-eye span').textContent = li.classList.contains('off') ? 'visibility_off' : 'visibility'; }
        });
        list.addEventListener('pointerdown', (e) => {
            const hd = e.target.closest('.drag-h'); if (!hd) return;
            const li = hd.closest('li'); li.classList.add('drag'); hd.setPointerCapture(e.pointerId);
            const move = (ev) => [...list.children].forEach(o => {
                if (o === li) return;
                const r = o.getBoundingClientRect();
                if (ev.clientY > r.top && ev.clientY < r.bottom) list.insertBefore(li, ev.clientY < r.top + r.height / 2 ? o : o.nextSibling);
            });
            const up = () => { li.classList.remove('drag'); hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); };
            hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up);
        });
        $('arr-reset').addEventListener('click', () => { localStorage.removeItem(orderKey()); localStorage.removeItem(hiddenKey()); closeModal(); rebuildHome(); });
        $('arr-save').addEventListener('click', () => {
            const lis = [...list.children];
            localStorage.setItem(orderKey(), JSON.stringify(lis.map(l => l.dataset.k)));
            localStorage.setItem(hiddenKey(), JSON.stringify(lis.filter(l => l.classList.contains('off')).map(l => l.dataset.k)));
            closeModal(); rebuildHome();
        });
    }

    /* ---------------------------------------------------------------------
       Speed: top loading bar, cached API answers, hover glow
       --------------------------------------------------------------------- */
    (function () {
        const f = window.fetch.bind(window); let n = 0;
        const bar = document.createElement('div'); bar.id = 'top-loader'; document.body.appendChild(bar);
        window.fetch = (u, ...a) => {
            const api = String(u && u.url || u).includes('/api/');
            if (api && !n++) bar.classList.add('on');
            return f(u, ...a).finally(() => { if (api && !--n) bar.classList.remove('on'); });
        };
    })();
    const jc = new Map();
    async function apiJson(url, ttl = 18e5) {
        const m = jc.get(url) || (() => { try { return JSON.parse(localStorage.getItem('sp_j_' + url) || 'null'); } catch (e) { return null; } })();
        if (m && Date.now() - m.t < ttl) { jc.set(url, m); return m.d; }
        const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json(), rec = { t: Date.now(), d }; jc.set(url, rec);
        try { localStorage.setItem('sp_j_' + url, JSON.stringify(rec)); }
        catch (e) { Object.keys(localStorage).filter(k => k.startsWith('sp_j_')).forEach(k => localStorage.removeItem(k)); }
        return d;
    }
    const SK = { list: '<div class="sk-row"></div>'.repeat(6), rows: ('<div class="rowcol">' + '<div class="sk-row"></div>'.repeat(4) + '</div>').repeat(2), cards: '<div class="sk-card"></div>'.repeat(6), wide: '<div class="sk-card wide"></div>'.repeat(3) };
    let hovEl = null;
    document.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const c = e.target.closest('.mini-row,.card,.song-card,.station,.browse-tile,.spotlight,.liked-card,.pl-tile');
        if (hovEl && hovEl !== c) { hovEl.style.removeProperty('--rx'); hovEl.style.removeProperty('--ry'); }
        hovEl = c; if (!c) return;
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', (x * 100) + '%'); c.style.setProperty('--my', (y * 100) + '%');
        if (c.matches('.card,.station,.browse-tile,.spotlight,.liked-card,.pl-tile')) {
            c.style.setProperty('--rx', ((0.5 - y) * 7).toFixed(1) + 'deg'); c.style.setProperty('--ry', ((x - 0.5) * 9).toFixed(1) + 'deg');
        }
    }, { passive: true });

    /* ---------------------------------------------------------------------
       Taste questions (languages, singers, vibes, moments)
       --------------------------------------------------------------------- */
    const prefsKey = () => 'sp_prefs_' + (state.user ? state.user.uid : '');
    function loadPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem(prefsKey()) || 'null');
            state.prefs = p && p.langs && p.langs.length ? { langs: p.langs, singers: p.singers || [], genres: (p.genres || []).filter(g => MOODS[g]), moments: p.moments || [] } : null;
        } catch (e) { state.prefs = null; }
    }
    function savePrefs() {
        try { localStorage.setItem(prefsKey(), JSON.stringify(state.prefs)); } catch (e) {}
        if (fs && state.user) fs.collection('users').doc(state.user.uid).set({ prefs: state.prefs }, { merge: true }).catch(() => {});
    }
    function moodQuery(m) {
        const mo = MOODS[m], p = state.prefs, rnd = (a) => a[Math.floor(Math.random() * a.length)];
        if (!mo.kw || mo.nl || !p || !p.langs.length) return rnd(mo.q);
        if (p.singers.length && Math.random() < 0.3) return `${rnd(p.singers)} ${mo.kw} songs`;
        return `${mo.kw} ${rnd(p.langs).toLowerCase()} songs`;
    }

    const ob = document.createElement('div'); ob.id = 'onboarding'; ob.className = 'onboarding hidden'; document.body.appendChild(ob);
    let obStep = 0, obSel = {};
    function showOnboarding() {
        const p = state.prefs || {};
        obSel = { langs: [...(p.langs || [])], singers: [...(p.singers || [])], genres: [...(p.genres || [])], moments: [...(p.moments || [])] };
        obStep = 0; ob.classList.remove('hidden'); renderOb();
    }
    function renderOb() {
        const steps = [
            { k: 'langs', t: 'Which languages do you listen to?', s: 'Pick as many as you like.', o: () => LANGS.map(x => [x, x]), min: 1 },
            { k: 'singers', t: 'Who are your favourite singers?', s: 'Based on your languages. You can skip this.', o: () => [...new Set(obSel.langs.flatMap(l => SINGERS[l] || []))].map(x => [x, x]) },
            { k: 'genres', t: 'What kind of music do you love?', s: 'Pick everything that fits.', o: () => GENRES, min: 1 },
            { k: 'moments', t: 'When do you listen the most?', s: 'We will build mixes for these moments. You can skip this.', o: () => MOMENTS.map(m => [m[0], m[1]]) }
        ];
        const st = steps[obStep], sel = obSel[st.k], last = obStep === steps.length - 1;
        ob.innerHTML = `<div class="ob-card"><div class="ob-dots">${steps.map((_, i) => `<i class="${i <= obStep ? 'on' : ''}"></i>`).join('')}</div>
            <h2>${st.t}</h2><p>${st.s}</p>
            <div class="ob-grid">${st.o().map(([v, l]) => `<button type="button" class="ob-chip${sel.includes(v) ? ' on' : ''}" data-v="${escapeHtml(v)}">${escapeHtml(l)}</button>`).join('')}</div>
            <div class="ob-actions">${obStep ? '<button type="button" class="btn-secondary" id="ob-back">Back</button>' : '<span></span>'}
            <button type="button" class="btn-primary" id="ob-next"${st.min && !sel.length ? ' disabled' : ''}>${last ? 'Build my music' : 'Next'}</button></div></div>`;
        const next = $('ob-next');
        ob.querySelectorAll('.ob-chip').forEach(b => b.addEventListener('click', () => {
            const v = b.dataset.v, i = sel.indexOf(v);
            if (i >= 0) sel.splice(i, 1); else sel.push(v);
            b.classList.toggle('on', i < 0);
            if (st.min) next.disabled = !sel.length;
        }));
        if ($('ob-back')) $('ob-back').addEventListener('click', () => { obStep--; renderOb(); });
        next.addEventListener('click', () => {
            if (!last) { obStep++; renderOb(); return; }
            const avail = new Set(obSel.langs.flatMap(l => SINGERS[l] || []));
            state.prefs = { langs: obSel.langs, singers: obSel.singers.filter(s => avail.has(s)), genres: obSel.genres, moments: obSel.moments };
            state.prefs.genres.forEach(g => bumpMood(g, 4));
            savePrefs(); ob.classList.add('hidden');
            elements.shelves.innerHTML = ''; buildShelves(); setView('home-view');
            showToast('Your music is ready');
        });
    }
    $('edit-prefs').addEventListener('click', () => { closeDrawer(); showOnboarding(); });

    /* ---------------------------------------------------------------------
       Search tab: browse tiles, collapsible side menu, offline shell
       --------------------------------------------------------------------- */
    $('browse-grid').innerHTML = Object.keys(MOODS).map(m =>
        `<button class="browse-tile" data-q="${escapeHtml(MOODS[m].q[0])}" style="--g1:${MOODS[m].g[0]};--g2:${MOODS[m].g[1]}"><strong>${MOODS[m].label}</strong><span>${MOODS[m].e}</span></button>`).join('');
    $('browse-grid').addEventListener('click', (e) => {
        const t = e.target.closest('.browse-tile'); if (!t) return;
        elements.searchInput.value = t.dataset.q; elements.clearSearchBtn.classList.remove('hidden'); executeSearch(t.dataset.q);
    });
    const navBtn = $('nav-collapse');
    function setNav(c) {
        elements.app.classList.toggle('nav-collapsed', c);
        navBtn.querySelector('span').textContent = c ? 'menu' : 'menu_open';
        try { localStorage.setItem('sp_navc', c ? '1' : '0'); } catch (e) {}
    }
    navBtn.addEventListener('click', () => setNav(!elements.app.classList.contains('nav-collapsed')));
    try { setNav(localStorage.getItem('sp_navc') === '1'); } catch (e) {}
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});

    /* ---------------------------------------------------------------------
       Home shelves (latest songs, stations, personal mixes ...)
       --------------------------------------------------------------------- */
    let shelfList = [], allShelves = [];
    const shelfIO = new IntersectionObserver((es) => es.forEach(e => {
        if (e.isIntersecting) { shelfIO.unobserve(e.target); loadShelf(e.target); }
    }), { root: elements.contentArea, rootMargin: '300px' });

    function buildShelves() {
        const p = state.prefs, top = topMood(), L = (p && p.langs.length) ? p.langs : ['Hindi'], lq = L[0].toLowerCase();
        shelfList = [{ t: 'Latest songs', q: `latest ${lq} songs 2026`, k: 'list', all: 1, n: 6 }];
        if (top) shelfList.push({ t: `Because you like ${MOODS[top].label} ${MOODS[top].e}`, q: moodQuery(top), k: 'rows', all: 1, m: top });
        shelfList.push({ t: 'Mood stations', k: 'stations', ms: ((p && p.genres.length) ? p.genres : ['romantic', 'retro', 'party', 'lofi', 'sad']).slice(0, 6) });
        if (p) {
            const sg = p.singers.slice(0, 3), gn = p.genres.slice(0, 3);
            for (let i = 0; i < Math.max(sg.length, gn.length); i++) {
                if (gn[i]) shelfList.push({ t: `${MOODS[gn[i]].label} ${L[i % L.length]}`, q: moodQuery(gn[i]), k: 'rows', all: 1, m: gn[i] });
                if (sg[i]) shelfList.push({ t: `More from ${sg[i]}`, q: `${sg[i]} songs`, k: 'cards' });
            }
            p.moments.slice(0, 2).forEach(k => { const m = MOMENTS.find(x => x[0] === k); if (m) shelfList.push({ t: `${m[1]} mix`, q: m[2], k: 'cards' }); });
        }
        shelfList.push({ t: 'Covers and remixes', q: 'hindi lofi remix songs', k: 'rows', all: 1, m: 'lofi' });
        if (!p) shelfList.push(...SHELVES.filter(s => s.k === 'cards'));
        shelfList.push({ t: 'Music videos for you', q: `new ${lq} music video 2026`, k: 'wide' });
        const ord = JSON.parse(localStorage.getItem(orderKey()) || '[]'), hid = JSON.parse(localStorage.getItem(hiddenKey()) || '[]');
        shelfList = shelfList.map((s, i) => [s, i]).sort((a, b) => {
            const x = ord.indexOf(shelfKey(a[0])), y = ord.indexOf(shelfKey(b[0]));
            return (x < 0 ? 1e3 + a[1] : x) - (y < 0 ? 1e3 + b[1] : y);
        }).map(a => a[0]);
        allShelves = shelfList.slice();
        shelfList = shelfList.filter(s => !hid.includes(shelfKey(s)));
        elements.shelves.innerHTML = `
            <div class="spotlight"><div><h2>Your mix</h2><p>Starts with what you love and keeps adapting as you listen.</p>
            <button class="btn-white" id="play-mix"><span class="material-symbols-rounded">play_arrow</span><span>Play mix</span></button></div>
            <div class="spot-disc"></div><div class="spot-art">${'<i></i>'.repeat(26)}</div></div>
            <div class="arrange-row"><button class="pill-btn" id="arrange-btn"><span class="material-symbols-rounded">swap_vert</span>Arrange sections</button></div>` +
            shelfList.map((s, i) => `<section class="shelf" data-i="${i}"><div class="shelf-head"><h3>${s.t}</h3>${s.all ? '<button class="pill-btn play-all">Play all</button>' : ''}</div><div class="shelf-body k-${s.k}">${SK[s.k] || ''}</div></section>`).join('');
        $('play-mix').addEventListener('click', () => startStation(topMood() || (state.prefs && state.prefs.genres[0]) || 'romantic'));
        $('arrange-btn').addEventListener('click', openArrange);
        elements.shelves.querySelectorAll('.shelf').forEach(el => shelfIO.observe(el));
    }

    async function startStation(m) {
        showToast(`Starting ${MOODS[m].label} radio...`, 1500);
        try {
            const d = await apiJson(`${API_BASE}/api/search?q=${encodeURIComponent(moodQuery(m))}&page=1`, 6e5);
            const items = [...(d.items || [])].sort(() => Math.random() - 0.5);
            if (!items.length) throw new Error('empty');
            items.forEach(i => { i._mood = m; });
            playTrack(items[0], [], { radio: true, mood: m });
            state.queue = items.slice(1, 9); state.source = `${MOODS[m].e} ${MOODS[m].label} radio`; renderQueue();
        } catch (e) { showToast('Could not start radio - is the server running?'); }
    }

    async function loadShelf(el) {
        const s = shelfList[+el.dataset.i], body = el.querySelector('.shelf-body');
        const hd = (img, it) => { img.onerror = () => { img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; }; img.src = it.thumb; }; img.src = `https://i.ytimg.com/vi/${it.id}/maxresdefault.jpg`; };
        if (s.k === 'stations') {
            body.innerHTML = s.ms.map(m => `<button class="station" data-m="${m}" style="--g1:${MOODS[m].g[0]};--g2:${MOODS[m].g[1]}"><span class="badge">STATION</span><strong>${MOODS[m].label} radio</strong><small>${MOODS[m].sub}</small><span class="material-symbols-rounded">play_circle</span></button>`).join('');
            body.querySelectorAll('.station').forEach(b => {
                b.addEventListener('click', () => startStation(b.dataset.m));
                apiJson(`${API_BASE}/api/search?q=${encodeURIComponent(MOODS[b.dataset.m].q[0])}&page=1`).then(d => {
                    const it = (d.items || []).find(x => x.views > 1e5) || (d.items || [])[0]; if (!it) return;
                    loadBestImage([`https://i.ytimg.com/vi/${it.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`, it.thumb], (u) => {
                        if (u !== PLACEHOLDER) { b.style.setProperty('--img', `url("${u}")`); b.classList.add('has-img'); }
                    });
                }).catch(() => {});
            });
            return;
        }
        try {
            const d = await apiJson(`${API_BASE}/api/search?q=${encodeURIComponent(s.q)}&page=1`);
            const items = (d.items || []).slice(0, s.n || (s.k === 'rows' ? 12 : 10));
            if (!items.length) { el.remove(); return; }
            if (s.k === 'list') {   // banner picture = cover of the newest song
                const sp = elements.shelves.querySelector('.spotlight'), it0 = items[0];
                if (sp && it0) loadBestImage([`https://i.ytimg.com/vi/${it0.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${it0.id}/hqdefault.jpg`, it0.thumb], (u) => {
                    if (u !== PLACEHOLDER) { sp.style.setProperty('--img', `url("${u}")`); sp.classList.add('has-img'); }
                });
            }
            const play = (i) => playTrack(i, items, { radio: true, mood: s.m || detectMood(i.title + ' ' + i.artist) });
            const row = (it, i) => `<button class="mini-row" data-i="${i}"><img data-src="${escapeHtml(it.thumb)}" alt=""><span class="mr-t"><strong class="truncate">${escapeHtml(it.title)}</strong><small class="truncate">${escapeHtml(it.artist)}${viewsHTML(it.views)}${it.duration ? ' • ' + escapeHtml(it.duration) : ''}</small></span></button>`;
            if (s.k === 'list') body.innerHTML = items.map(row).join('');
            else if (s.k === 'rows') {
                let cols = '';
                for (let c = 0; c < items.length; c += 4) cols += '<div class="rowcol">' + items.slice(c, c + 4).map((it, k) => row(it, c + k)).join('') + '</div>';
                body.innerHTML = cols;
            } else {
                body.innerHTML = items.map((it, i) => `<button class="card" data-i="${i}"><img alt=""><strong class="truncate">${escapeHtml(it.title)}</strong><small class="truncate">${escapeHtml(it.artist)}${viewsHTML(it.views)}</small></button>`).join('');
                body.querySelectorAll('.card').forEach((c, i) => hd(c.querySelector('img'), items[i]));
            }
            body.querySelectorAll('img[data-src]').forEach(im => setImg(im, im.dataset.src));
            body.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => play(items[+b.dataset.i])));
            const pa = el.querySelector('.play-all');
            if (pa) pa.addEventListener('click', () => { setShuffle(false); playTrack(items[0], items, {}); });
        } catch (e) { body.innerHTML = `<p class="shelf-err">${navigator.onLine ? 'Could not load. Is the server running?' : 'You are offline. Open Library to play your downloaded songs.'}</p>`; }
    }

    /* ---------------------------------------------------------------------
       Playback speed (1x - 2x)
       --------------------------------------------------------------------- */
    function applySpeed() {
        const r = state.speed;
        try { audio.defaultPlaybackRate = r; audio.playbackRate = r; audio.preservesPitch = true; } catch (e) {}
        let shown = r;
        if (ytReady && state.engine === 'yt') {
            try {
                const av = ytPlayer.getAvailablePlaybackRates();
                shown = av.reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a);
                ytPlayer.setPlaybackRate(shown);
            } catch (e) {}
        }
        const b = $('speed-btn'); if (b) { b.querySelector('small').textContent = shown + 'x'; b.classList.toggle('active', shown !== 1); }
    }
    function openSpeedSheet() {
        openModal(`<h3 class="modal-title">Playback speed</h3>
            <div class="speed-grid">${SPEEDS.map(s => `<button class="chip${s === state.speed ? ' active' : ''}" data-s="${s}">${s}x</button>`).join('')}</div>
            <p class="modal-sub">Songs streamed from YouTube snap to the nearest speed YouTube allows (for example 1.25x instead of 1.2x or 1.3x). Downloaded and phone songs use the exact speed.</p>
            <div class="modal-actions"><button class="btn-primary" id="modal-done">Done</button></div>`);
        elements.modalSheet.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
            state.speed = +b.dataset.s; applySpeed();
            elements.modalSheet.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('active', x === b));
        }));
        $('modal-done').addEventListener('click', closeModal);
    }

    /* ---------------------------------------------------------------------
       Cover animation: waves moving in a circle around the artwork
       --------------------------------------------------------------------- */
    const cv = $('wave-canvas'), cx = cv.getContext('2d');
    let waveCols = ['#ff4f8b', '#a855f7'], wt = 0, amp = 0.2;
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function setWaveColors(t) {
        const g = GRADS[hashStr(String(t.id)) % GRADS.length]; waveCols = g;
        elements.fullPlayerOverlay.style.setProperty('--c1', g[0]);
        elements.fullPlayerOverlay.style.setProperty('--c2', g[1]);
    }
    function drawWaves() {
        requestAnimationFrame(drawWaves);
        if (elements.fullPlayerOverlay.classList.contains('hidden')) return;
        const s = cv.clientWidth, d = Math.min(window.devicePixelRatio || 1, 2);
        if (!s) return;
        if (cv.width !== Math.round(s * d)) cv.width = cv.height = Math.round(s * d);
        cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, s, s);
        amp += ((state.isPlaying && !reduceMotion ? 1 : 0.15) - amp) * 0.05;
        wt += 0.016 * (state.isPlaying ? 1 : 0.25);
        const beat = 0.5 + 0.5 * Math.sin(wt * 5), R = s * 0.375, c = s / 2;
        [waveCols[0], waveCols[1], '#ffffff'].forEach((col, k) => {
            cx.beginPath();
            for (let a = 0; a <= 360; a += 3) {
                const r = a * Math.PI / 180;
                const w = Math.sin(r * (5 + k * 2) + wt * (2 + k) * (k % 2 ? -1 : 1)) * 0.6 + Math.sin(r * (9 - k) - wt * 1.7) * 0.4;
                const rad = R + s * 0.02 * k + w * s * 0.03 * amp * (1 + beat * 0.5);
                const x = c + Math.cos(r) * rad, y = c + Math.sin(r) * rad;
                a ? cx.lineTo(x, y) : cx.moveTo(x, y);
            }
            cx.closePath(); cx.strokeStyle = col; cx.lineWidth = k === 2 ? 1 : 2.4;
            cx.globalAlpha = k === 2 ? 0.5 : 0.9; cx.shadowColor = col; cx.shadowBlur = 8; cx.stroke();
        });
        cx.globalAlpha = 1; cx.shadowBlur = 0;
    }
    requestAnimationFrame(drawWaves);

    /* ---------------------------------------------------------------------
       Click animations: ripple + heart burst
       --------------------------------------------------------------------- */
    document.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('button, .chip, .song-card, .pl-tile, .liked-card');
        if (!b || b.matches('input')) return;
        const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
        const s = document.createElement('span'); s.className = 'ripple';
        s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
        b.classList.add('rip-host'); b.appendChild(s); setTimeout(() => s.remove(), 600);
    });
    function burst(el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        for (let i = 0; i < 8; i++) {
            const h = document.createElement('span'); h.className = 'burst material-symbols-rounded'; h.textContent = 'favorite';
            const a = i / 8 * Math.PI * 2;
            h.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * 48}px;--dy:${Math.sin(a) * 48}px`;
            document.body.appendChild(h); setTimeout(() => h.remove(), 750);
        }
    }

    /* ---------------------------------------------------------------------
       Seek bar + player buttons
       --------------------------------------------------------------------- */
    elements.seekBar.addEventListener('input', (e) => {
        seeking = true;
        const total = currentDuration();
        if (total > 0) elements.currentTimeLbl.textContent = formatTime((e.target.value / 100) * total);
    });
    elements.seekBar.addEventListener('change', (e) => {
        const total = currentDuration();
        if (total > 0) seekTo((e.target.value / 100) * total);
        seeking = false;
    });

    elements.mainPlayBtn.addEventListener('click', togglePlayPause);
    elements.miniPlayBtn.addEventListener('click', togglePlayPause);
    elements.nextBtn.addEventListener('click', playNextTrack);
    elements.miniNextBtn.addEventListener('click', playNextTrack);
    elements.prevBtn.addEventListener('click', playPrevTrack);
    elements.back10Btn.addEventListener('click', () => skipBy(-10));
    elements.fwd10Btn.addEventListener('click', () => skipBy(10));
    elements.shuffleBtn.addEventListener('click', () => setShuffle(!state.shuffle));
    elements.repeatBtn.addEventListener('click', cycleRepeat);

    elements.openFullPlayerBtn.addEventListener('click', () => elements.fullPlayerOverlay.classList.remove('hidden'));
    elements.closePlayerBtn.addEventListener('click', () => elements.fullPlayerOverlay.classList.add('hidden'));
    elements.wishlistToggleBtn.addEventListener('click', () => toggleLike(state.currentTrack, elements.wishlistToggleBtn));
    $('mini-like-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleLike(state.currentTrack, $('mini-like-btn')); });
    $('mini-prev-btn').addEventListener('click', playPrevTrack);
    $('speed-btn').addEventListener('click', openSpeedSheet);
    $('add-pl-btn').addEventListener('click', () => { if (state.currentTrack) openPicker(state.currentTrack); });
    elements.queueChips.addEventListener('click', (e) => {
        const c = e.target.closest('.chip'); if (!c) return;
        state.qTab = c.dataset.t;
        elements.queueChips.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
        if (state.qTab === 'similar' && !state.similar) loadSimilar();
        renderQueue();
    });

    /* ---------------------------------------------------------------------
       Start
       --------------------------------------------------------------------- */
    updateNetworkStatus();
    loadYouTubeAPI();

    if (auth) {
        auth.onAuthStateChanged((user) => {
            if (registering) return;
            if (user) {
                startSession(userFromFirebase(user));
            } else {
                if (state.user) resetSession();
                showAuth(authView);
            }
        });
    } else {
        // Firebase could not load (for example you are offline). Use the last saved login.
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem('sp_session') || 'null'); } catch (e) {}
        if (cached && cached.uid && !configMissing) startSession(cached);
        else showAuth('login');
    }
});