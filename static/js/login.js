/* MediSync - Login Page JS */
window.API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
  ? 'http://127.0.0.1:5000'
  : '';  // Same-origin on Vercel (Flask serves both frontend + API)

const originalFetch = window.fetch;
window.fetch = function() {
    let [resource, config] = arguments;
    if (!config) {
        config = {};
    }
    if (config.credentials === undefined) {
        config.credentials = 'include';
    }
    return originalFetch(resource, config);
};

// Password toggle
    var toggleBtn = document.getElementById('passwordToggle');
    var passInput = document.getElementById('password');
    var eyeOn = document.getElementById('eyeIcon');
    var eyeOff = document.getElementById('eyeOffIcon');
    toggleBtn.addEventListener('click', function() {
        var isPassword = passInput.type === 'password';
        passInput.type = isPassword ? 'text' : 'password';
        eyeOn.style.display = isPassword ? 'none' : 'block';
        eyeOff.style.display = isPassword ? 'block' : 'none';
    });

(function () {
    var form = document.getElementById('loginForm');
    var errEl = document.getElementById('loginError');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errEl.style.display = 'none';

        var username = document.getElementById('username').value.trim();
        var password = document.getElementById('password').value;

        if (!username || !password) {
            errEl.textContent = 'Please enter both username and password.';
            errEl.style.display = 'block';
            return;
        }

        var btn = document.getElementById('loginBtn');
        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
            var res = await fetch(window.API_BASE + '/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            });
            var data = await res.json();
            if (data.success) {
                // Store auth token and user data for cross-page persistence
                if (data.token) localStorage.setItem('ms_auth_token', data.token);
                if (data.user) localStorage.setItem('ms_user', JSON.stringify(data.user));
                window.location.href = '/dashboard';
            } else {
                errEl.textContent = data.error || 'Invalid credentials.';
                errEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Sign In';
            }
        } catch (err) {
            errEl.textContent = 'Connection error. Please try again.';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    });
})();
