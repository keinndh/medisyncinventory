/* MediSync - Settings JS */
(function () {
    // --- Load current profile ---
    async function loadProfile() {
        try {
            var res = await fetch(window.API_BASE + '/api/me');
            var user = await res.json();
            document.getElementById('settingsName').value = user.full_name || '';
            document.getElementById('settingsUsername').value = user.username || '';
            if (user.profile_picture) {
                // base64 data URLs don't need cache-busting; file paths do
                var initTs = user.profile_picture.startsWith('data:') ? '' : '?t=' + Date.now();
                document.getElementById('settingsProfilePic').innerHTML = '<img src="' + user.profile_picture + initTs + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }
        } catch (e) { /* ignore */ }
    }

    // --- Save profile ---
    document.getElementById('profileForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var pw = document.getElementById('settingsPassword').value;
        var pwConfirm = document.getElementById('settingsPasswordConfirm').value;
        if (pw && pw !== pwConfirm) {
            showToast('Passwords do not match.', 'error');
            return;
        }
        var payload = {
            full_name: document.getElementById('settingsName').value.trim(),
            username: document.getElementById('settingsUsername').value.trim()
        };
        if (pw) payload.password = pw;

        try {
            var res = await fetch(window.API_BASE + '/api/settings/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Profile updated successfully.');
                document.getElementById('settingsPassword').value = '';
                document.getElementById('settingsPasswordConfirm').value = '';
                // Update header
                var nameEl = document.getElementById('headerUserName');
                if (nameEl) nameEl.textContent = data.full_name || data.username;
            } else { showToast(data.error || 'Failed to update.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Upload profile picture ---
    document.getElementById('profilePicInput').addEventListener('change', async function () {
        var file = this.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append('picture', file);
        try {
            var res = await fetch(window.API_BASE + '/api/settings/picture', { method: 'POST', body: fd });
            var data = await res.json();
            if (res.ok) {
                showToast('Profile picture updated.');
                var ts = data.profile_picture.startsWith('data:') ? '' : '?t=' + Date.now();
                var picUrl = data.profile_picture + ts;
                document.getElementById('settingsProfilePic').innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                var headerPic = document.getElementById('headerProfilePic');
                if (headerPic) headerPic.innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                // Update localStorage cache so other pages reflect the new picture
                try {
                    var cached = JSON.parse(localStorage.getItem('ms_user') || '{}');
                    cached.profile_picture = data.profile_picture;
                    localStorage.setItem('ms_user', JSON.stringify(cached));
                } catch(e) {}
            } else { showToast(data.error || 'Upload failed.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    loadProfile();
})();
