(async () => {
    // --- Global error safety: never let an unhandled error close the launcher ---
    window.onerror = function (msg, url, line) {
        console.error('[LOGIN] Unhandled error:', msg, 'at', url, ':', line);
        try { window.notifications.show('error', 'Error', String(msg)); } catch (_) {}
        return true;
    };
    window.onunhandledrejection = function (ev) {
        console.error('[LOGIN] Unhandled rejection:', ev.reason);
        try { window.notifications.show('error', 'Error', String(ev.reason && ev.reason.message ? ev.reason.message : ev.reason)); } catch (_) {}
    };

    // Window Controls
    document.getElementById('btn-min').onclick = () => window.soul.minimize();
    document.getElementById('btn-max').onclick = () => window.soul.maximize();
    document.getElementById('btn-close').onclick = () => window.soul.close();

    // Theme Management (accent)
    const savedTheme = await window.soul.getSetting('theme');
    if (savedTheme) {
        document.body.classList.remove(...Array.from(document.body.classList).filter(c=>c.startsWith('theme-')));
        document.body.classList.add(`theme-${savedTheme}`);
    }
    document.body.classList.remove('app-paper','app-modern');

    // Slideshow Logic
    const slides = document.querySelectorAll('.slide');
    const slideTitle = document.getElementById('slide-title');
    const slideDesc = document.getElementById('slide-desc');
    
    const slideData = [
        { title: "Best Performance", desc: "Experience Minecraft like never before with Soul's optimizations." },
        { title: "Custom Mods", desc: "Easily manage and launch your favorite modpacks with one click." },
        { title: "Smooth UI", desc: "A modern, responsive interface designed for gamers." },
        { title: "Fast Updates", desc: "Stay up to date with the latest features and security patches." }
    ];

    let currentSlide = 0;
    function nextSlide() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
        
        // Update content with fade
        slideTitle.style.opacity = 0;
        slideDesc.style.opacity = 0;
        setTimeout(() => {
            slideTitle.textContent = slideData[currentSlide].title;
            slideDesc.textContent = slideData[currentSlide].desc;
            slideTitle.style.opacity = 1;
            slideDesc.style.opacity = 1;
        }, 300);
    }
    setInterval(nextSlide, 3000);

    // Mouse Effect for Slideshow
    const loginRight = document.querySelector('.login-right');
    const slideshow = document.querySelector('.slideshow');
    loginRight.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.75) * 40; // Offset since it's on the right
        const y = (e.clientY / window.innerHeight - 0.5) * 40;
        slideshow.style.transform = `scale(1.1) translate(${x}px, ${y}px)`;
    });

    loginRight.addEventListener('mouseleave', () => {
        slideshow.style.transform = `scale(1) translate(0, 0)`;
    });

    // Account Selection Dropdown Logic
    const accountSelection = document.getElementById('account-selection');
    const selectedTrigger = document.getElementById('selected-account-trigger');
    const dropdownList = document.getElementById('accounts-dropdown-list');
    let allAccounts = [];
    let isDropdownOpen = false;

    async function loadAccounts() {
        allAccounts = await window.soul.getSetting('accounts') || [];
        allAccounts.reverse(); // Newest first

        if (allAccounts.length > 0) {
            accountSelection.classList.remove('hidden');
            updateDropdown();
        } else {
            accountSelection.classList.add('hidden');
        }
    }

    function updateDropdown() {
        const latest = allAccounts[0];
        const others = allAccounts.slice(1);

        // Update Trigger (Selected)
        const avatar = latest.type === 'microsoft' ? latest.skin : '../../assets/icons/icon.png';
        selectedTrigger.innerHTML = `
            <img src="${avatar}" class="acc-avatar" onerror="this.src='../../assets/icons/icon.png'">
            <div class="acc-info">
                <span class="acc-name">${latest.name}</span>
                <span class="acc-type">${latest.type} Account</span>
            </div>
            <div class="acc-actions">
                <button class="acc-remove-btn" id="btn-remove-latest" title="Remove Account">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <button class="acc-select-btn" id="btn-select-latest" title="Login">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
                <i class="fa-solid fa-chevron-down drop-arrow"></i>
            </div>
        `;

        // Handle direct selection click
        document.getElementById('btn-select-latest').onclick = (e) => {
            e.stopPropagation();
            selectAccount(latest);
        };

        // Handle remove click
        document.getElementById('btn-remove-latest').onclick = (e) => {
            e.stopPropagation();
            removeAccount(latest);
        };

        // Update List (Others)
        dropdownList.innerHTML = '';
        if (others.length === 0) {
            selectedTrigger.querySelector('.drop-arrow').style.display = 'none';
        } else {
            others.forEach(acc => {
                const card = document.createElement('div');
                card.className = 'account-card';
                const accAvatar = acc.type === 'microsoft' ? acc.skin : '../../assets/icons/icon.png';
                card.innerHTML = `
                    <img src="${accAvatar}" class="acc-avatar" onerror="this.src='../../assets/icons/icon.png'">
                    <div class="acc-info">
                        <span class="acc-name">${acc.name}</span>
                        <span class="acc-type">${acc.type} Account</span>
                    </div>
                    <div class="acc-card-actions">
                        <button class="acc-remove-btn mini" title="Remove Account">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                        <i class="fa-solid fa-chevron-right acc-arrow"></i>
                    </div>
                `;
                
                card.querySelector('.acc-remove-btn').onclick = (e) => {
                    e.stopPropagation();
                    removeAccount(acc);
                };

                card.onclick = (e) => {
                    e.stopPropagation();
                    selectAccount(acc);
                };
                dropdownList.appendChild(card);
            });
        }
    }

    async function removeAccount(account) {
        let accounts = await window.soul.getSetting('accounts') || [];
        accounts = accounts.filter(a => !(a.name === account.name && a.type === account.type));
        await window.soul.setSetting('accounts', accounts);
        
        window.notifications.show('warning', 'Account Removed', `Removed account "${account.name}"`);
        loadAccounts();
    }

    selectedTrigger.onclick = (e) => {
        if (allAccounts.length <= 1) {
            selectAccount(allAccounts[0]);
            return;
        }
        isDropdownOpen = !isDropdownOpen;
        selectedTrigger.classList.toggle('active', isDropdownOpen);
        dropdownList.classList.toggle('hidden', !isDropdownOpen);
        e.stopPropagation();
    };

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        isDropdownOpen = false;
        selectedTrigger.classList.remove('active');
        dropdownList.classList.add('hidden');
    });

    async function selectAccount(account) {
        showLoader(`Logging in as ${account.name}...`);
        await window.soul.setSetting('currentAccount', account);
        
        window.notifications.show('success', 'Welcome Back', `Logged in as ${account.name}`);
        setTimeout(() => {
            window.location.href = '../home/home.html';
        }, 1000);
    }

    loadAccounts();

    // DISCORD RPC
    window.soul.setRPC('Soul Launcher', 'On Login Screen');

    // Login Logic
    const btnMsLogin = document.getElementById('btn-ms-login');
    const btnEmailLogin = document.getElementById('btn-email-login');
    const btnSignup = document.getElementById('btn-signup');
    const btnForgotPw = document.getElementById('btn-forgot-pw');
    const btnOfflineLogin = document.getElementById('btn-offline-login');
    const loginButtons = document.querySelector('.login-buttons');
    const offlineInputGroup = document.getElementById('offline-input-group');
    const offlineUsername = document.getElementById('offline-username');
    const btnOfflineConfirm = document.getElementById('btn-offline-confirm');
    const btnOfflineCancel = document.getElementById('btn-offline-cancel');
    const loginOverlay = document.getElementById('login-overlay');
    const overlayMsg = document.getElementById('overlay-msg');

    const showLoader = (msg) => {
        overlayMsg.textContent = msg;
        loginOverlay.classList.remove('hidden');
    };

    const hideLoader = () => {
        loginOverlay.classList.add('hidden');
    };

    btnMsLogin.onclick = async () => {
        showLoader('Connecting to Microsoft...');
        window.notifications.show('info', 'Network Connected', 'Connecting to Microsoft services...');
        
        try {
            const account = await window.soul.msLogin();
            await addAccount(account);
            overlayMsg.textContent = 'Welcome, ' + account.name;
            window.notifications.show('success', 'Connected Successfully', 'Logged in as ' + account.name);
            
            setTimeout(() => {
                window.location.href = '../home/home.html';
            }, 1500);
        } catch (e) {
            console.error(e);
            hideLoader();
            window.notifications.show('error', 'Login Failed', 'Microsoft authentication failed or was cancelled.');
        }
    };

    btnOfflineLogin.onclick = () => {
        loginButtons.classList.add('hidden');
        offlineInputGroup.classList.remove('hidden');
        offlineUsername.focus();
    };

    btnOfflineCancel.onclick = () => {
        offlineInputGroup.classList.add('hidden');
        loginButtons.classList.remove('hidden');
    };

    btnOfflineConfirm.onclick = async () => {
        const username = offlineUsername.value.trim();
        const mcRegex = /^[a-zA-Z0-9_]{3,16}$/;

        if (!mcRegex.test(username)) {
            window.notifications.show('error', 'Invalid Name', 'Username must be 3-16 characters (letters, numbers, and underscores only).');
            return;
        }

        showLoader('Preparing Offline Session...');

        const offlineAccount = {
            id: 'off-' + Math.random().toString(36).substr(2, 9),
            name: username,
            type: 'offline',
            skin: 'steve',
            token: null
        };

        await addAccount(offlineAccount);
        overlayMsg.textContent = 'Hello, ' + username;
        window.notifications.show('success', 'Connected Successfully', 'Logged in as ' + username);
        
        setTimeout(() => {
            window.location.href = '../home/home.html';
        }, 1000);
    };

    // Email/Password login — navigate to dedicated email login page
    btnEmailLogin.onclick = () => {
        window.location.href = 'email-login.html';
    };

    // Sign up — navigate to dedicated sign up page
    btnSignup.onclick = () => {
        window.location.href = 'signup.html';
    };

    // Forgot password — navigate to dedicated password reset page
    btnForgotPw.onclick = (e) => {
        e.preventDefault();
        window.location.href = 'forgot-password.html';
    };

    async function addAccount(account) {
        let accounts = await window.soul.getSetting('accounts') || [];
        const index = accounts.findIndex(a => a.name === account.name && a.type === account.type);
        if (index !== -1) {
            window.notifications.show('warning', 'Account Exist', `The account "${account.name}" already exists in the system.`);
            accounts.splice(index, 1);
        }
        accounts.push(account);
        await window.soul.setSetting('accounts', accounts);
        await window.soul.setSetting('currentAccount', account);
    }
})();
