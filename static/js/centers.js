/* MediSync - Centers JS */
(function () {
    var deleteMode = false;
    var currentCenterId = null;
    var recipientDeleteMode = false;

    // --- Options Dropdown ---
    var optDropdown = document.getElementById('centerOptionsDropdown');
    document.getElementById('centerOptionsBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        optDropdown.classList.toggle('show');
    });
    document.addEventListener('click', function () { optDropdown.classList.remove('show'); });

    // --- Enter Delete Mode ---
    document.getElementById('enterDeleteModeBtn').addEventListener('click', function () {
        optDropdown.classList.remove('show');
        deleteMode = true;
        document.getElementById('centerManageBarTop').style.display = 'flex';
        document.getElementById('centerOptionsWrap').style.display = 'none';
        document.getElementById('addCenterBtn').style.display = 'none';
        renderCenterSelectBoxes(true);
    });

    document.getElementById('cancelCenterSelectBtn').addEventListener('click', exitDeleteMode);
    function exitDeleteMode() {
        deleteMode = false;
        document.getElementById('centerManageBarTop').style.display = 'none';
        document.getElementById('centerOptionsWrap').style.display = 'block';
        document.getElementById('addCenterBtn').style.display = '';
        renderCenterSelectBoxes(false);
    }

    function renderCenterSelectBoxes(show) {
        document.querySelectorAll('.center-select-checkbox').forEach(function (cb) {
            cb.style.display = show ? 'inline-block' : 'none';
            cb.checked = false;
        });
        document.querySelectorAll('.center-action-btn').forEach(function (btn) {
            btn.style.display = show ? 'none' : '';
        });
    }

    document.getElementById('selectAllCentersBtn').addEventListener('click', function () {
        document.querySelectorAll('.center-select-checkbox').forEach(function (cb) {
            cb.checked = true;
        });
    });

    document.getElementById('deleteSelectedCentersBtn').addEventListener('click', async function () {
        var checked = Array.from(document.querySelectorAll('.center-select-checkbox:checked'));
        if (!checked.length) { showToast('No centers selected.', 'error'); return; }
        if (!confirm('Delete ' + checked.length + ' selected center(s)?')) return;
        for (var i = 0; i < checked.length; i++) {
            var id = checked[i].dataset.id;
            await fetch(window.API_BASE + '/api/centers/' + id, { method: 'DELETE' });
        }
        showToast('Selected centers deleted.');
        exitDeleteMode();
        loadCenters();
    });

    // --- Add Center ---
    document.getElementById('addCenterBtn').addEventListener('click', function () {
        openModal('addCenterModal');
        document.getElementById('centerName').focus();
    });

    document.getElementById('centerForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = document.getElementById('centerName').value.trim();
        if (!name) { showToast('Enter center name.', 'error'); return; }
        try {
            var res = await fetch(window.API_BASE + '/api/centers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Center added successfully.');
                document.getElementById('centerName').value = '';
                closeModal('addCenterModal');
                loadCenters();
            } else { showToast(data.error || 'Failed.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Load Centers ---
    async function loadCenters() {
        try {
            var res = await fetch(window.API_BASE + '/api/centers');
            var centers = await res.json();
            var container = document.getElementById('centersList');
            if (!centers.length) {
                container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg><div class="empty-title">No centers added</div><div class="empty-sub">Add a center to get started</div></div>';
                return;
            }
            container.innerHTML = centers.map(function (c) {
                return '<div class="center-group">' +
                    '<div class="center-group-header" style="display:flex;justify-content:space-between;align-items:center;padding-right:8px;">' +
                    '<input type="checkbox" class="center-select-checkbox" data-id="' + c.id + '" style="display:none;" onclick="event.stopPropagation()">' +
                    '<div onclick="toggleCenter(this.parentElement, ' + c.id + ')" style="flex:1;display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:1.05rem;color:var(--navy);">' +
                    '<svg viewBox="0 0 24 24" style="width:20px;height:20px;margin-right:12px;transition:0.3s;"><polyline points="9 6 15 12 9 18"/></svg>' +
                    escapeHtml(c.name) + '</div>' +
                    '<div style="display:flex;gap:12px;align-items:center;">' +
                    '<button class="btn btn-ghost btn-sm center-action-btn" onclick="editCenterName(' + c.id + ', \'' + escapeHtml(c.name).replace(/'/g, "\\'") + '\')" style="font-weight:700;text-transform:uppercase;font-size:0.75rem;letter-spacing:0.5px;color:var(--text);">' +
                    'Edit Center' +
                    '</button>' +
                    '<button class="btn btn-ghost btn-sm center-action-btn" onclick="showRecipients(' + c.id + ', \'' + escapeHtml(c.name).replace(/'/g, "\\'") + '\')" style="font-weight:700;text-transform:uppercase;font-size:0.75rem;letter-spacing:0.5px;color:var(--primary);">' +
                    'View Recipients' +
                    '</button>' +
                    '</div>' +
                    '</div>' +
                    '<div class="center-group-body" id="centerBody' + c.id + '">' +
                    '<div style="padding:16px;color:var(--text-muted);">Click to load transactions...</div>' +
                    '</div></div>';
            }).join('');
        } catch (e) { /* ignore */ }
    }

    window.editCenterName = function(id, name) {
        document.getElementById('editCenterId').value = id;
        document.getElementById('editCenterNameInput').value = name;
        openModal('editCenterModal');
        document.getElementById('editCenterNameInput').focus();
    };

    document.getElementById('editCenterForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var id = document.getElementById('editCenterId').value;
        var name = document.getElementById('editCenterNameInput').value.trim();
        if (!name) { showToast('Center name is required.', 'error'); return; }
        try {
            var res = await fetch(window.API_BASE + '/api/centers/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Center updated successfully.');
                closeModal('editCenterModal');
                loadCenters();
            } else { showToast(data.error || 'Failed.', 'error'); }
        } catch(e) { showToast('Connection error.', 'error'); }
    });

    window.deleteCenter = async function (id, name) {
        if (!confirm('Are you sure you want to delete center "' + name + '"?')) return;
        try {
            var res = await fetch(window.API_BASE + '/api/centers/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Center deleted successfully.');
                loadCenters();
            } else {
                showToast('Failed to delete center.', 'error');
            }
        } catch (e) {
            showToast('Connection error.', 'error');
        }
    };

    var currentCenterDispData = [];
    var currentCenterQueueData = [];
    var currentCenterDispPage = 1;
    var currentCenterQueuePage = 1;
    var currentOpenCenterId = null;

    window.changeCenterDispPage = function(page) {
        currentCenterDispPage = page;
        renderCenterTransactions();
    };

    window.changeCenterQueuePage = function(page) {
        currentCenterQueuePage = page;
        renderCenterTransactions();
    };

    function renderCenterTransactions() {
        if (!currentOpenCenterId) return;
        var body = document.getElementById('centerBody' + currentOpenCenterId);
        if (!body) return;

        var html = '';
        if (currentCenterDispData.length) {
            html += '<h4 style="font-weight:700;margin-bottom:8px;font-size:0.9rem;">Dispensing Transactions</h4>';
            html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Date</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Contact</th><th>Dispenser</th></tr></thead><tbody>';
            var pageData = window.paginateData(currentCenterDispData, currentCenterDispPage, 10);
            html += pageData.map(function (d) {
                return '<tr><td>' + formatDateTime(d.date_time) + '</td><td>' + escapeHtml(d.medicine_name) +
                    '</td><td>' + d.quantity_dispensed + '</td><td>' + escapeHtml(d.recipient_name) +
                    '</td><td>' + escapeHtml(d.recipient_contact || 'N/A') +
                    '</td><td>' + escapeHtml(d.dispenser_name) + '</td></tr>';
            }).join('');
            html += '</tbody></table></div>';
            html += '<div id="centerDispPagination" style="padding: 8px 0 16px;"></div>';
        }
        if (currentCenterQueueData.length) {
            html += '<h4 style="font-weight:700;margin:16px 0 8px;font-size:0.9rem;">Queued Requests</h4>';
            html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Date</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Status</th></tr></thead><tbody>';
            var pageData = window.paginateData(currentCenterQueueData, currentCenterQueuePage, 10);
            html += pageData.map(function (q) {
                return '<tr><td>' + formatDateTime(q.created_at) + '</td><td>' + escapeHtml(q.medicine_name) +
                    '</td><td>' + q.quantity_requested + '</td><td>' + escapeHtml(q.recipient_name) +
                    '</td><td>' + statusBadge(q.status) + '</td></tr>';
            }).join('');
            html += '</tbody></table></div>';
            html += '<div id="centerQueuePagination" style="padding: 8px 0 16px;"></div>';
        }
        if (!currentCenterDispData.length && !currentCenterQueueData.length) {
            html = '<div class="empty-state" style="padding:24px;"><div class="empty-title">No transactions</div><div class="empty-sub">No dispensing or queue records for this center</div></div>';
        }
        
        body.innerHTML = html;
        
        if (currentCenterDispData.length) {
            window.renderPagination('centerDispPagination', currentCenterDispData.length, currentCenterDispPage, 10, 'changeCenterDispPage');
        }
        if (currentCenterQueueData.length) {
            window.renderPagination('centerQueuePagination', currentCenterQueueData.length, currentCenterQueuePage, 10, 'changeCenterQueuePage');
        }
    }

    window.toggleCenter = async function (header, centerId) {
        var body = document.getElementById('centerBody' + centerId);
        var isOpen = header.classList.contains('open');
        document.querySelectorAll('.center-group-header').forEach(function (h) { h.classList.remove('open'); });
        document.querySelectorAll('.center-group-body').forEach(function (b) { b.classList.remove('show'); });
        if (isOpen) {
            currentOpenCenterId = null;
            return;
        }
        header.classList.add('open');
        body.classList.add('show');
        currentOpenCenterId = centerId;
        currentCenterDispPage = 1;
        currentCenterQueuePage = 1;

        try {
            var res = await fetch(window.API_BASE + '/api/centers/' + centerId + '/transactions');
            var data = await res.json();
            currentCenterDispData = data.dispensings;
            currentCenterQueueData = data.queued;
            renderCenterTransactions();
        } catch (e) {
            body.innerHTML = '<div style="padding:16px;color:var(--coral);">Failed to load transactions</div>';
        }
    };

    // --- Recipients Modal ---
    window.showRecipients = async function (centerId, centerName) {
        currentCenterId = centerId;
        recipientDeleteMode = false;
        document.getElementById('recipientsModalTitle').textContent = 'Recipients — ' + centerName;
        document.getElementById('selectAllRecipientsBtn').style.display = 'none';
        document.getElementById('deleteSelectedRecipientsBtn').style.display = 'none';
        document.getElementById('cancelRecipientSelectBtn').style.display = 'none';
        document.getElementById('recipientOptionsWrap').style.display = '';
        await loadRecipients(centerId);
        openModal('recipientsModal');
    };

    // --- Recipient Options Dropdown ---
    var recOptDropdown = document.getElementById('recipientOptionsDropdown');
    document.getElementById('recipientOptionsBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        recOptDropdown.classList.toggle('show');
    });
    document.addEventListener('click', function () { 
        if(recOptDropdown) recOptDropdown.classList.remove('show'); 
    });

    document.getElementById('showAddRecipientBtn').addEventListener('click', function() {
        if(recOptDropdown) recOptDropdown.classList.remove('show');
        document.getElementById('newRecipientName').value = '';
        document.getElementById('newRecipientContact').value = '';
        openModal('addRecipientModal');
        setTimeout(() => document.getElementById('newRecipientName').focus(), 100);
    });

    document.getElementById('addRecipientForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var name = document.getElementById('newRecipientName').value.trim();
        var contact = document.getElementById('newRecipientContact').value.trim();
        if (!name) { showToast('Name is required.', 'error'); return; }
        try {
            var res = await fetch(window.API_BASE + '/api/recipients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, contact: contact, center_id: currentCenterId })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Recipient added successfully.');
                closeModal('addRecipientModal');
                loadRecipients(currentCenterId);
            } else {
                showToast(data.error || 'Failed.', 'error');
            }
        } catch(e) {
            showToast('Connection error.', 'error');
        }
    });

    async function loadRecipients(centerId) {
        try {
            var res = await fetch(window.API_BASE + '/api/centers/' + centerId + '/recipients');
            var recipients = await res.json();
            var container = document.getElementById('recipientsCardGrid');
            if (!recipients.length) {
                container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; padding:48px;"><div class="empty-title">No recipients saved for this center</div></div>';
                return;
            }
            container.innerHTML = recipients.map(function (r) {
                return '<div class="recipient-card' + (recipientDeleteMode ? ' selecting' : '') + '">' +
                    '<div class="recipient-check-cell" style="' + (recipientDeleteMode ? '' : 'display:none;') + '"><input type="checkbox" class="recipient-select-cb" data-id="' + r.id + '" style="width:18px;height:18px;accent-color:var(--coral);"></div>' +
                    '<div class="recipient-avatar">' + escapeHtml(r.name.charAt(0)) + '</div>' +
                    '<div class="recipient-info">' +
                    '<div class="recipient-name">' + escapeHtml(r.name) + '</div>' +
                    '<div class="recipient-contact">' + escapeHtml(r.contact || 'No Contact Number') + '</div>' +
                    '<div class="recipient-date">Added: ' + formatDate(r.created_at) + '</div>' +
                    '</div>' +
                    '</div>';
            }).join('');
        } catch (e) {
            document.getElementById('recipientsCardGrid').innerHTML = '<div class="empty-state" style="grid-column: 1/-1; padding:48px;"><div class="empty-title">Failed to load recipients</div></div>';
        }
    }

    // Recipient delete mode
    document.getElementById('enterRecipientDeleteModeBtn').addEventListener('click', function () {
        recipientDeleteMode = true;
        if(recOptDropdown) recOptDropdown.classList.remove('show');
        document.getElementById('recipientOptionsWrap').style.display = 'none';
        document.getElementById('selectAllRecipientsBtn').style.display = '';
        document.getElementById('deleteSelectedRecipientsBtn').style.display = '';
        document.getElementById('cancelRecipientSelectBtn').style.display = '';
        document.querySelectorAll('.recipient-check-cell').forEach(function (td) {
            td.style.display = '';
        });
        document.querySelectorAll('.recipient-card').forEach(function (c) {
            c.classList.add('selecting');
        });
    });

    document.getElementById('cancelRecipientSelectBtn').addEventListener('click', function () {
        recipientDeleteMode = false;
        document.getElementById('recipientOptionsWrap').style.display = '';
        document.getElementById('selectAllRecipientsBtn').style.display = 'none';
        document.getElementById('deleteSelectedRecipientsBtn').style.display = 'none';
        document.getElementById('cancelRecipientSelectBtn').style.display = 'none';
        document.querySelectorAll('.recipient-check-cell').forEach(function (td) {
            td.style.display = 'none';
        });
        document.querySelectorAll('.recipient-card').forEach(function (c) {
            c.classList.remove('selecting');
        });
    });

    document.getElementById('selectAllRecipientsBtn').addEventListener('click', function () {
        document.querySelectorAll('.recipient-select-cb').forEach(function (cb) { cb.checked = true; });
    });

    document.getElementById('deleteSelectedRecipientsBtn').addEventListener('click', async function () {
        var checked = Array.from(document.querySelectorAll('.recipient-select-cb:checked'));
        if (!checked.length) { showToast('No recipients selected.', 'error'); return; }
        if (!confirm('Delete ' + checked.length + ' selected recipient(s)?')) return;
        for (var i = 0; i < checked.length; i++) {
            await fetch(window.API_BASE + '/api/recipients/' + checked[i].dataset.id, { method: 'DELETE' });
        }
        showToast('Selected recipients deleted.');
        await loadRecipients(currentCenterId);
        // exit delete mode
        document.getElementById('cancelRecipientSelectBtn').click();
    });

    loadCenters();
})();
