/* MediSync - Account Page JS */
(function () {
    // --- Load current profile ---
    async function loadProfile() {
        try {
            var res = await fetch(window.API_BASE + '/api/me');
            var user = await res.json();
            document.getElementById('settingsName').value = user.full_name || '';
            document.getElementById('settingsUsername').value = user.username || '';
            if (user.profile_picture) {
                var picUrl = user.profile_picture;
                if (picUrl.startsWith('/')) picUrl = window.API_BASE + picUrl;
                document.getElementById('settingsProfilePic').innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }
            // Hide sub-accounts section for sub-accounts
            if (user.role === 'sub') {
                var card = document.getElementById('subAccountsCard');
                if (card) card.style.display = 'none';
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
        // Validate file type
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file.', 'error');
            this.value = '';
            return;
        }
        // Validate file size (2MB max)
        if (file.size > 2 * 1024 * 1024) {
            showToast('Image too large. Max 2MB.', 'error');
            this.value = '';
            return;
        }
        var fd = new FormData();
        fd.append('picture', file);
        try {
            var res = await fetch(window.API_BASE + '/api/settings/picture', { method: 'POST', body: fd });
            var data = await res.json();
            if (res.ok && data.profile_picture) {
                showToast('Profile picture updated.');
                var picUrl = data.profile_picture;
                if (picUrl.startsWith('/')) picUrl = window.API_BASE + picUrl;
                document.getElementById('settingsProfilePic').innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                var headerPic = document.getElementById('headerProfilePic');
                if (headerPic) headerPic.innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                // Update sessionStorage/localStorage cache
                try {
                    var cached = JSON.parse(localStorage.getItem('ms_user') || '{}');
                    cached.profile_picture = data.profile_picture;
                    localStorage.setItem('ms_user', JSON.stringify(cached));
                } catch(e) {}
            } else { showToast(data.error || 'Upload failed.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // ===================================
    // SUB-ACCOUNTS MANAGEMENT
    // ===================================
    async function loadSubAccounts() {
        try {
            var res = await fetch(window.API_BASE + '/api/accounts/sub');
            var subs = await res.json();
            var badge = document.getElementById('subCountBadge');
            if (badge) badge.textContent = subs.length + ' / 5';
            var addBtn = document.getElementById('addSubBtn');
            if (addBtn) addBtn.disabled = subs.length >= 5;

            var tbody = document.getElementById('subAccountsBody');
            if (!subs.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No team accounts yet. Click "Add Account" to create one.</td></tr>';
                return;
            }
            tbody.innerHTML = subs.map(function(s) {
                return '<tr>' +
                    '<td>' + escapeHtml(s.full_name) + '</td>' +
                    '<td><code>' + escapeHtml(s.username) + '</code></td>' +
                    '<td>' + formatDate(s.created_at) + '</td>' +
                    '<td>' +
                        '<div class="actions">' +
                            '<button class="btn btn-outline btn-sm" onclick="viewSubActivity(' + s.id + ', \'' + escapeHtml(s.full_name).replace(/'/g, "\\'") + '\')" title="View Activity">' +
                                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                                ' Activity' +
                            '</button>' +
                            '<button class="btn btn-yellow btn-sm" onclick="resetSubPassword(' + s.id + ')" title="Reset Password">' +
                                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
                                ' Reset PW' +
                            '</button>' +
                            '<button class="btn btn-danger btn-sm" onclick="deleteSubAccount(' + s.id + ')" title="Delete Account">' +
                                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</td>' +
                '</tr>';
            }).join('');
        } catch (e) { /* ignore */ }
    }

    // --- Add Sub-Account ---
    document.getElementById('addSubBtn').addEventListener('click', function() {
        document.getElementById('addSubForm').reset();
        openModal('addSubModal');
    });

    document.getElementById('submitSubBtn').addEventListener('click', async function() {
        var fullName = document.getElementById('subFullName').value.trim();
        var username = document.getElementById('subUsername').value.trim();
        var password = document.getElementById('subPassword').value;
        if (!fullName || !username || !password) {
            showToast('All fields are required.', 'error');
            return;
        }
        if (password.length < 6) {
            showToast('Password must be at least 6 characters.', 'error');
            return;
        }
        try {
            var res = await fetch(window.API_BASE + '/api/accounts/sub', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name: fullName, username: username, password: password })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Team account created successfully.');
                closeModal('addSubModal');
                loadSubAccounts();
            } else {
                showToast(data.error || 'Failed to create account.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- View Activity ---
    window.viewSubActivity = async function(subId, name) {
        document.getElementById('subActivityTitle').textContent = 'Activity - ' + name;
        document.getElementById('subActivityBody').innerHTML = '<tr class="empty-row"><td colspan="3">Loading...</td></tr>';
        openModal('subActivityModal');
        try {
            var res = await fetch(window.API_BASE + '/api/accounts/sub/' + subId + '/activity');
            var logs = await res.json();
            var tbody = document.getElementById('subActivityBody');
            if (!logs.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No activity found for this account.</td></tr>';
                return;
            }
            tbody.innerHTML = logs.map(function(l) {
                return '<tr>' +
                    '<td>' + formatDateTime(l.timestamp) + '</td>' +
                    '<td><span class="badge badge-active">' + escapeHtml(l.action) + '</span></td>' +
                    '<td>' + escapeHtml(l.details) + '</td>' +
                '</tr>';
            }).join('');
        } catch (e) {
            document.getElementById('subActivityBody').innerHTML = '<tr class="empty-row"><td colspan="3">Failed to load activity.</td></tr>';
        }
    };

    // --- Reset Password ---
    window.resetSubPassword = function(subId) {
        document.getElementById('resetPwSubId').value = subId;
        document.getElementById('resetPwValue').value = '';
        openModal('resetPwModal');
    };

    document.getElementById('submitResetPwBtn').addEventListener('click', async function() {
        var subId = document.getElementById('resetPwSubId').value;
        var newPw = document.getElementById('resetPwValue').value;
        if (!newPw || newPw.length < 6) {
            showToast('Password must be at least 6 characters.', 'error');
            return;
        }
        try {
            var res = await fetch(window.API_BASE + '/api/accounts/sub/' + subId + '/reset-password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: newPw })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Password reset successfully.');
                closeModal('resetPwModal');
            } else {
                showToast(data.error || 'Failed to reset password.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Delete Sub-Account ---
    window.deleteSubAccount = function(subId) {
        document.getElementById('deleteSubId').value = subId;
        openModal('deleteSubModal');
    };

    document.getElementById('confirmDeleteSubBtn').addEventListener('click', async function() {
        var subId = document.getElementById('deleteSubId').value;
        try {
            var res = await fetch(window.API_BASE + '/api/accounts/sub/' + subId, { method: 'DELETE' });
            var data = await res.json();
            if (res.ok) {
                showToast('Account deleted.');
                closeModal('deleteSubModal');
                loadSubAccounts();
            } else {
                showToast(data.error || 'Failed to delete.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // Init
    loadProfile();
    loadSubAccounts();
})();
