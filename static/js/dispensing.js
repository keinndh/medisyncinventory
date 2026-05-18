/* MediSync - Dispensing JS */
(function () {
    var allMedNames = [];   // array of medicine names (strings)
    var allCenters = [];    // center objects
    var currentQueueItem = null; // for queue detail modal
    var fullMedsList = [];  // raw meds from endpoint
    var selectedBatches = {}; // { batchId: qtyAllocated }

    // --- Validate Philippine mobile number ---
    function validateContact(val) {
        return /^09\d{9}$/.test(val);
    }

    // --- Autocomplete helper ---
    function setupAutocomplete(inputId, dropdownId, fetchFn, onSelect) {
        var input = document.getElementById(inputId);
        var dropdown = document.getElementById(dropdownId);
        var debounce;

        input.addEventListener('input', function () {
            clearTimeout(debounce);
            var q = this.value.trim();
            if (!q) { dropdown.classList.remove('show'); return; }
            debounce = setTimeout(function () {
                fetchFn(q, function (items) {
                    if (!items.length) { dropdown.classList.remove('show'); return; }
                    dropdown.innerHTML = items.map(function (item) {
                        var dataAttrs = '';
                        if (item.contact) dataAttrs += ' data-contact="' + escapeHtml(item.contact) + '"';
                        if (item.centerId) dataAttrs += ' data-center-id="' + escapeHtml(item.centerId) + '"';
                        
                        return '<div class="autocomplete-item" data-val="' + escapeHtml(item.value || item) + '"' + dataAttrs + '>' +
                            escapeHtml(item.label || item) +
                            (item.sub ? '<div class="item-sub">' + escapeHtml(item.sub) + '</div>' : '') +
                            '</div>';
                    }).join('');
                    dropdown.classList.add('show');
                    dropdown.querySelectorAll('.autocomplete-item').forEach(function (el) {
                        el.addEventListener('mousedown', function (e) {
                            e.preventDefault();
                            onSelect(el.dataset.val, el);
                            dropdown.classList.remove('show');
                        });
                    });
                });
            }, 200);
        });

        input.addEventListener('blur', function () {
            setTimeout(function () { dropdown.classList.remove('show'); }, 200);
        });
        input.addEventListener('focus', function () {
            if (input.value.trim()) input.dispatchEvent(new Event('input'));
        });
    }

    // --- Load medicines for autocomplete ---
    async function loadMedicineNames() {
        try {
            var res = await fetch(window.API_BASE + '/api/medicines');
            fullMedsList = await res.json();
            var meds = fullMedsList.filter(function (m) { return m.status === 'Active' || m.status === 'Near Expiry'; });
            var grouped = {};
            meds.forEach(function (m) {
                if (!grouped[m.article_name]) grouped[m.article_name] = 0;
                grouped[m.article_name] += m.quantity;
            });
            allMedNames = Object.keys(grouped).map(function (k) { return { name: k, qty: grouped[k] }; });
        } catch (e) { /* ignore */ }
    }

    function searchMedicines(q, cb) {
        var results = allMedNames.filter(function (m) {
            return m.name.toLowerCase().includes(q.toLowerCase());
        }).map(function (m) {
            return { value: m.name, label: m.name, sub: 'Total Qty: ' + m.qty };
        });
        cb(results);
        // update stock display
        var match = allMedNames.find(function (m) { return m.name.toLowerCase() === q.toLowerCase(); });
        if (match) document.getElementById('dispStock').textContent = match.qty;
    }

    setupAutocomplete('dispMedicine', 'medDropdown', searchMedicines, function (val) {
        document.getElementById('dispMedicine').value = val;
        var match = allMedNames.find(function (m) { return m.name === val; });
        document.getElementById('dispStock').textContent = match ? match.qty : '-';
    });

    // Update stock when typing exact name
    document.getElementById('dispMedicine').addEventListener('input', function () {
        var val = this.value;
        var match = allMedNames.find(function (m) { return m.name === val; });
        document.getElementById('dispStock').textContent = match ? match.qty : '-';
    });

    // --- Load centers for select ---
    async function loadCenterOptions() {
        try {
            var res = await fetch(window.API_BASE + '/api/centers');
            allCenters = await res.json();
            var sel = document.getElementById('dispCenter');
            sel.innerHTML = '<option value="">Select center...</option>';
            allCenters.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                sel.appendChild(opt);
            });
        } catch (e) { /* ignore */ }
    }

    // --- Recipient autocomplete ---
    function searchRecipients(q, cb) {
        fetch(window.API_BASE + '/api/recipients/search?q=' + encodeURIComponent(q))
            .then(function (r) { return r.json(); })
            .then(function (items) {
                cb(items.map(function (r) {
                    return { 
                        value: r.name, 
                        label: r.full_display, // Show "Name (Center)"
                        sub: r.contact ? 'Contact: ' + r.contact : '',
                        contact: r.contact,
                        centerId: r.center_id
                    };
                }));
            })
            .catch(function () { cb([]); });
    }

    setupAutocomplete('dispRecipient', 'recipientDropdown', searchRecipients, function (val, el) {
        document.getElementById('dispRecipient').value = val;
        // auto-fill contact and center if available
        if (el.dataset.contact) {
            document.getElementById('dispContact').value = el.dataset.contact;
        }
        if (el.dataset.centerId) {
            document.getElementById('dispCenter').value = el.dataset.centerId;
        }
        checkSaveRecipientBtn();
    });

    document.getElementById('dispRecipient').addEventListener('input', function () {
        checkSaveRecipientBtn();
    });

    function checkSaveRecipientBtn() {
        var name = document.getElementById('dispRecipient').value.trim();
        var centerId = document.getElementById('dispCenter').value;
        document.getElementById('saveRecipientBtn').style.display = (name && centerId) ? 'inline-flex' : 'none';
    }
    document.getElementById('dispCenter').addEventListener('change', checkSaveRecipientBtn);

    // --- Contact number validation ---
    document.getElementById('dispContact').addEventListener('input', function () {
        var val = this.value.trim();
        var errEl = document.getElementById('contactError');
        if (val && !validateContact(val)) {
            errEl.style.display = 'block';
        } else {
            errEl.style.display = 'none';
        }
    });

    // --- Save Recipient ---
    document.getElementById('saveRecipientBtn').addEventListener('click', function () {
        var name = document.getElementById('dispRecipient').value.trim();
        var contact = document.getElementById('dispContact').value.trim();
        var centerId = document.getElementById('dispCenter').value;
        var centerName = '';
        var center = allCenters.find(function (c) { return String(c.id) === String(centerId); });
        if (center) centerName = center.name;

        document.getElementById('saveRecipientNameDisplay').value = name;
        document.getElementById('saveRecipientContactDisplay').value = contact;
        document.getElementById('saveRecipientCenterDisplay').value = centerName;
        openModal('saveRecipientModal');
    });

    document.getElementById('saveRecipientConfirm').addEventListener('click', async function () {
        var name = document.getElementById('dispRecipient').value.trim();
        var contact = document.getElementById('dispContact').value.trim();
        var centerId = document.getElementById('dispCenter').value;
        if (!name || !centerId) { showToast('Recipient name and center are required.', 'error'); return; }
        try {
            var res = await fetch(window.API_BASE + '/api/recipients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, contact: contact, center_id: parseInt(centerId) })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Recipient profile saved successfully.');
                closeModal('saveRecipientModal');
            } else {
                showToast(data.error || 'Failed to save.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Batch Selection ---
    document.getElementById('btnOpenBatchSelect').addEventListener('click', openBatchSelection);
    document.getElementById('dispQty').addEventListener('click', openBatchSelection);

    function openBatchSelection() {
        var medName = document.getElementById('dispMedicine').value.trim();
        if (!medName) { showToast('Please select a medicine first.', 'error'); return; }
        
        var availableBatches = fullMedsList.filter(function(m) { 
            return m.article_name === medName && (m.status === 'Active' || m.status === 'Near Expiry'); 
        });

        if (!availableBatches.length) { showToast('No available stock for this medicine.', 'error'); return; }

        availableBatches.sort(function(a,b) {
             return new Date(a.expiration_date || '9999-12-31') - new Date(b.expiration_date || '9999-12-31');
        });

        // --- FEFO Auto-Allocation ---
        var totalDesired = parseInt(document.getElementById('dispQty').value) || 0;
        // Auto-allocate if totalDesired is set and no manual selection exists yet
        if (totalDesired > 0 && Object.keys(selectedBatches).length === 0) {
            var remaining = totalDesired;
            availableBatches.forEach(function(b) {
                if (remaining <= 0) return;
                var take = Math.min(remaining, b.quantity);
                selectedBatches[b.id] = take;
                remaining -= take;
            });
        }

        document.getElementById('batchModalMedName').textContent = medName;
        var tbody = document.getElementById('batchModalBody');
        tbody.innerHTML = availableBatches.map(function(b) {
            var alloc = selectedBatches[b.id] || 0;
            return '<tr>' + 
                   '<td>' + escapeHtml(b.stock_number) + '</td>' +
                   '<td>' + formatDate(b.expiration_date) + '</td>' +
                   '<td>' + b.quantity + '</td>' +
                   '<td>' + 
                     '<input type="number" id="batchQtyInput_' + b.id + '" value="' + alloc + '" class="form-control" min="0" oninput="setBatchQty(' + b.id + ', this.value)" style="width:80px;text-align:center;padding:4px;">' +
                   '</td>' +
                   '</tr>';
        }).join('');
        
        updateTotalBatchesSelected();
        openModal('batchSelectionModal');
    }

    window.setBatchQty = function(id, val) {
        var next = parseInt(val) || 0;
        if (next < 0) next = 0;
        selectedBatches[id] = next;
        if(next === 0) delete selectedBatches[id];
        updateTotalBatchesSelected();
    };

    function updateTotalBatchesSelected() {
        var total = 0;
        for (var k in selectedBatches) { total += parseInt(selectedBatches[k]); }
        document.getElementById('batchTotalAllocated').textContent = total;
    }

    document.getElementById('btnConfirmBatches').addEventListener('click', function() {
        var total = 0;
        for (var k in selectedBatches) { total += parseInt(selectedBatches[k]); }
        document.getElementById('dispQty').value = total || '';
        closeModal('batchSelectionModal');
    });

    document.getElementById('dispMedicine').addEventListener('input', function () {
        selectedBatches = {};
        document.getElementById('dispQty').value = '';
        document.getElementById('dispStock').textContent = '-';
    });

    // --- Dispense Form Submit ---
    let currentDispensePayload = null;

    document.getElementById('dispenseForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var contact = document.getElementById('dispContact').value.trim();
        if (contact && !validateContact(contact)) {
            showToast('Invalid contact number. Must start with 09 and be 11 digits.', 'error');
            return;
        }

        var medName = document.getElementById('dispMedicine').value.trim();
        var manualBatches = Object.keys(selectedBatches).map(function(id) {
            return { id: parseInt(id), qty: parseInt(selectedBatches[id]) };
        }).filter(function(b) { return b.qty > 0; });

        var payload = {
            dispenser_name: document.getElementById('dispDispenser').value.trim(),
            article_name: medName,
            recipient_name: document.getElementById('dispRecipient').value.trim(),
            recipient_contact: contact,
            center_id: document.getElementById('dispCenter').value || null,
            quantity: manualBatches.length > 0 ? 
                      manualBatches.reduce((acc, b) => acc + b.qty, 0) : 
                      parseInt(document.getElementById('dispQty').value),
            remarks: document.getElementById('dispRemarks').value.trim(),
            selected_batches: manualBatches
        };

        if (!payload.dispenser_name || !payload.article_name || !payload.recipient_name || !payload.quantity) {
            showToast('Please fill in all required fields.', 'error');
            return;
        }

        currentDispensePayload = payload;
        submitDispense(payload);
    });

    async function submitDispense(payload) {
        try {
            var res = await fetch(window.API_BASE + '/api/dispense', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var data = await res.json();

            if (data.requires_confirmation) {
                // Store the selected_batches context for confirm actions
                currentDispensePayload = payload;
                document.getElementById('confirmDispenseMessage').textContent = data.message;
                openModal('confirmDispenseModal');
                return;
            }

            closeModal('confirmDispenseModal');

            if (data.queued) {
                showToast(data.message || 'Added to request queue.', 'warning');
                loadQueue();
            } else if (data.dispensing || res.ok) {
                showToast(data.message || 'Medicine dispensed successfully.');
                document.getElementById('dispenseForm').reset();
                document.getElementById('dispStock').textContent = '-';
                document.getElementById('saveRecipientBtn').style.display = 'none';
                document.getElementById('contactError').style.display = 'none';
                selectedBatches = {};
            } else {
                showToast(data.error || 'Failed to dispense.', 'error');
            }
            loadToday();
            loadMedicineNames();
        } catch (e) { showToast('Connection error.', 'error'); }
    }

    document.getElementById('btnDispenseAll').addEventListener('click', function () {
        if (currentDispensePayload) {
            currentDispensePayload.confirm_action = 'dispense_all';
            submitDispense(currentDispensePayload);
        }
    });

    document.getElementById('btnDispenseAndQueue').addEventListener('click', function () {
        if (currentDispensePayload) {
            currentDispensePayload.confirm_action = 'queue_remaining';
            submitDispense(currentDispensePayload);
        }
    });

    document.getElementById('btnDispenseAndCancel').addEventListener('click', function () {
        if (currentDispensePayload) {
            currentDispensePayload.confirm_action = 'cancel_remaining';
            submitDispense(currentDispensePayload);
        }
    });

    document.getElementById('btnQueueAll').addEventListener('click', function () {
        if (currentDispensePayload) {
            currentDispensePayload.confirm_action = 'queue_all';
            submitDispense(currentDispensePayload);
        }
    });

    // --- Request Queue ---
    var queueData = [];
    var queuePage = 1;
    
    window.changeQueuePage = function(page) {
        queuePage = page;
        renderQueue();
    };

    function renderQueue() {
        var container = document.getElementById('queueList');
        if (!queueData.length) {
            container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><div class="empty-title">No pending requests</div><div class="empty-sub">Queue is empty</div></div>';
            document.getElementById('queuePagination').innerHTML = '';
            return;
        }

        var pageData = window.paginateData(queueData, queuePage, 10);
        window.renderPagination('queuePagination', queueData.length, queuePage, 10, 'changeQueuePage');

        container.innerHTML = pageData.map(function (q) {
            var isPriority = q.priority > 0;
            var borderStyle = isPriority ? 'border-color: var(--info); box-shadow: 0 0 0 1px var(--info);' : '';
            return '<div class="queue-item" style="' + borderStyle + '" onclick="showQueueDetail(' + q.id + ')">' +
                '<div class="queue-info">' +
                '<div class="queue-title">' +
                (isPriority ? '<span class="badge badge-pending" style="margin-right:6px;font-size:0.7rem;">Priority</span>' : '') +
                escapeHtml(q.medicine_name) + ' &mdash; Qty: ' + q.quantity_requested + '</div>' +
                '<div class="queue-detail">Recipient: ' + escapeHtml(q.recipient_name) + ' | Center: ' + escapeHtml(q.center_name || 'N/A') + '</div>' +
                '</div>' +
                '<div class="queue-actions" onclick="event.stopPropagation()">' +
                '<button class="btn btn-outline btn-sm" onclick="prioritizeQueue(' + q.id + ')">Prioritize</button>' +
                '<button class="btn btn-primary btn-sm" onclick="fulfillQueue(' + q.id + ')">Fulfill</button>' +
                '</div></div>';
        }).join('');
    }

    async function loadQueue() {
        try {
            var res = await fetch(window.API_BASE + '/api/queue');
            var items = await res.json();
            document.getElementById('queueCount').textContent = items.length + ' pending';
            queueData = items;
            queuePage = 1;
            renderQueue();
        } catch (e) { /* ignore */ }
    }

    // --- Queue Detail Modal ---
    window.showQueueDetail = function (id) {
        fetch(window.API_BASE + '/api/queue')
            .then(function (r) { return r.json(); })
            .then(function (items) {
                var q = items.find(function (i) { return i.id === id; });
                if (!q) return;
                currentQueueItem = q;
                
                var container = document.getElementById('queueDetailContent');
                var fields = [
                    { label: 'Queue ID', val: '#' + q.id },
                    { label: 'Medicine', val: q.medicine_name },
                    { label: 'Quantity', val: q.quantity_requested },
                    { label: 'Recipient', val: q.recipient_name },
                    { label: 'Contact', val: q.recipient_contact || 'N/A' },
                    { label: 'Center', val: q.center_name || 'N/A' },
                    { label: 'Dispenser', val: q.dispenser_name },
                    { label: 'Priority', val: q.priority > 0 ? '<span class="badge badge-pending">Prioritized</span>' : 'Normal' },
                    { label: 'Status', val: statusBadge(q.status) },
                    { label: 'Queued At', val: formatDateTime(q.created_at) }
                ];

                container.innerHTML = '<table class="data-table"><tbody>' + 
                    fields.map(f => '<tr><th style="text-align:left;width:200px;background:var(--primary-bg);">' + f.label + '</th><td>' + f.val + '</td></tr>').join('') + 
                    '</tbody></table>';
                
                document.getElementById('queueDetailPrioritize').dataset.id = id;
                document.getElementById('queueDetailFulfill').dataset.id = id;
                document.getElementById('queueDetailUnprioritize').dataset.id = id;
                document.getElementById('queueDetailRemove').dataset.id = id;
                
                // Toggle prioritize/unprioritize buttons
                if (q.priority > 0) {
                    document.getElementById('queueDetailPrioritize').style.display = 'none';
                    document.getElementById('queueDetailUnprioritize').style.display = 'inline-flex';
                } else {
                    document.getElementById('queueDetailPrioritize').style.display = 'inline-flex';
                    document.getElementById('queueDetailUnprioritize').style.display = 'none';
                }

                openModal('queueDetailModal');
            });
    };

    document.getElementById('queueDetailPrioritize').addEventListener('click', function () {
        var id = this.dataset.id;
        fetch(window.API_BASE + '/api/queue/' + id + '/prioritize', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function () {
                showToast('Request prioritized.');
                closeModal('queueDetailModal');
                loadQueue();
            });
    });

    document.getElementById('queueDetailUnprioritize').addEventListener('click', function () {
        var id = this.dataset.id;
        fetch(window.API_BASE + '/api/queue/' + id + '/unprioritize', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function () {
                showToast('Priority removed.');
                closeModal('queueDetailModal');
                loadQueue();
            });
    });
    document.getElementById('queueDetailFulfill').addEventListener('click', function () {
        var id = parseInt(this.dataset.id);
        if (id) { closeModal('queueDetailModal'); fulfillQueue(id); }
    });
    document.getElementById('queueDetailRemove').addEventListener('click', async function () {
        var id = this.dataset.id;
        if (!confirm('Are you sure you want to remove this request from the queue?')) return;
        try {
            var res = await fetch(window.API_BASE + '/api/queue/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Request removed from queue.');
                closeModal('queueDetailModal');
                loadQueue();
            } else {
                var data = await res.json();
                showToast(data.error || 'Failed to remove.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    window.prioritizeQueue = async function (id) {
        try {
            await fetch(window.API_BASE + '/api/queue/' + id + '/prioritize', { method: 'PUT' });
            showToast('Request prioritized.');
            loadQueue();
        } catch (e) { showToast('Failed to prioritize.', 'error'); }
    };

    window.fulfillQueue = async function (id) {
        try {
            var res = await fetch(window.API_BASE + '/api/queue/' + id + '/fulfill', { method: 'PUT' });
            var data = await res.json();
            if (res.ok) {
                showToast('Request fulfilled and dispensed.');
                loadQueue();
                loadToday();
                loadMedicineNames();
                if (data.dispense_id) {
                    window.open(window.API_BASE + '/api/dispense/' + data.dispense_id + '/receipt', '_blank');
                }
            } else {
                showToast(data.error || 'Cannot fulfill request.', 'error');
            }
        } catch (e) { showToast('Connection error.', 'error'); }
    };

    // --- Today's Distribution ---

    function formatRemarks(remarks) {
        if (!remarks) return '';
        var map = {
            'dispense_all': 'Dispensed All',
            'queue_remaining': 'Queued Remaining',
            'cancel_remaining': 'Cancelled Remaining',
            'queue_all': 'Queued All',
            'Partial dispense': 'Partial Dispense',
            'Partial dispense, remaining cancelled': 'Partial Dispense — Remaining Cancelled',
            'Fulfilled from queue': 'Fulfilled from Queue'
        };
        // Try exact match first
        if (map[remarks.trim()]) return map[remarks.trim()];
        // Otherwise clean up underscores and capitalize words
        return remarks.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    var todayData = [];
    var todayPage = 1;
    
    window.changeTodayPage = function(page) {
        todayPage = page;
        renderToday();
    };

    function renderToday() {
        var tbody = document.getElementById('todayBody');
        if (!todayData.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No dispensing records for today</td></tr>';
            document.getElementById('todayPagination').innerHTML = '';
            return;
        }
        
        var pageData = window.paginateData(todayData, todayPage, 10);
        window.renderPagination('todayPagination', todayData.length, todayPage, 10, 'changeTodayPage');

        tbody.innerHTML = pageData.map(function (d) {
            return '<tr><td>' + escapeHtml(d.dispenser_name) + '</td><td>' + formatDateTime(d.date_time) +
                '</td><td>' + escapeHtml(d.medicine_name) + '</td><td>' + d.quantity_dispensed +
                '</td><td>' + escapeHtml(d.recipient_name) + '</td><td>' + escapeHtml(d.recipient_contact) +
                '</td><td>' + escapeHtml(d.center_name) + '</td><td>' + formatRemarks(d.remarks) +
                '</td><td><a href="/api/dispense/' + d.id + '/receipt" class="btn btn-ghost btn-sm" target="_blank">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                ' PDF</a></td></tr>';
        }).join('');
    }

    async function loadToday() {
        try {
            var res = await fetch(window.API_BASE + '/api/dispense/today');
            var items = await res.json();
            todayData = items;
            todayPage = 1;
            renderToday();
        } catch (e) {
            document.getElementById('todayBody').innerHTML = '<tr class="empty-row"><td colspan="9">Failed to load</td></tr>';
            document.getElementById('todayPagination').innerHTML = '';
        }
    }

    // --- History ---
    document.getElementById('historyBtn').addEventListener('click', function () {
        loadHistory();
        openModal('historyModal');
    });

    var historyDebounce;
    document.getElementById('historySearch').addEventListener('input', function () {
        clearTimeout(historyDebounce);
        historyDebounce = setTimeout(loadHistory, 300);
    });
    document.getElementById('historyDate').addEventListener('change', loadHistory);

    var historyData = [];
    var historyPage = 1;
    
    window.changeHistoryPage = function(page) {
        historyPage = page;
        renderHistory();
    };

    function renderHistory() {
        var tbody = document.getElementById('historyBody');
        if (!historyData.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No history found</td></tr>';
            document.getElementById('historyPagination').innerHTML = '';
            return;
        }
        
        var pageData = window.paginateData(historyData, historyPage, 10);
        window.renderPagination('historyPagination', historyData.length, historyPage, 10, 'changeHistoryPage');

        tbody.innerHTML = pageData.map(function (d) {
            return '<tr><td>' + d.id + '</td><td>' + escapeHtml(d.dispenser_name) +
                '</td><td>' + formatDateTime(d.date_time) + '</td><td>' + escapeHtml(d.medicine_name) +
                '</td><td>' + d.quantity_dispensed + '</td><td>' + escapeHtml(d.recipient_name) +
                '</td><td>' + escapeHtml(d.recipient_contact) + '</td><td>' + escapeHtml(d.center_name) +
                '</td><td><a href="/api/dispense/' + d.id + '/receipt" class="btn btn-ghost btn-sm" target="_blank">PDF</a></td></tr>';
        }).join('');
    }

    async function loadHistory() {
        var params = new URLSearchParams();
        var search = document.getElementById('historySearch').value.trim();
        var date = document.getElementById('historyDate').value;
        if (search) params.set('search', search);
        if (date) params.set('date', date);

        try {
            var res = await fetch(window.API_BASE + '/api/dispense/history?' + params.toString());
            var items = await res.json();
            historyData = items;
            historyPage = 1;
            renderHistory();
        } catch (e) {
            document.getElementById('historyBody').innerHTML = '<tr class="empty-row"><td colspan="9">Failed</td></tr>';
            document.getElementById('historyPagination').innerHTML = '';
        }
    }

    // --- Quick Add Center ---
    document.getElementById('addCenterFromDispense').addEventListener('click', function () {
        document.getElementById('quickCenterName').value = '';
        openModal('quickCenterModal');
    });
    document.getElementById('quickCenterSubmit').addEventListener('click', async function () {
        var name = document.getElementById('quickCenterName').value.trim();
        if (!name) { showToast('Enter center name.', 'error'); return; }
        try {
            var res = await fetch(window.API_BASE + '/api/centers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Center added.');
                closeModal('quickCenterModal');
                loadCenterOptions();
            } else { showToast(data.error || 'Failed.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // Init
    loadMedicineNames();
    loadCenterOptions();
    loadQueue();
    loadToday();
})();
