/* MediSync - Inventory JS */
(function () {
    var allMedicines = [];
    var systemCategories = [];
    var systemCategoryTypes = [];

    // --- Load Stats ---
    async function loadInvStats() {
        try {
            var res = await fetch(window.API_BASE + '/api/dashboard/stats');
            var data = await res.json();
            document.getElementById('invStatTotal').textContent = data.total_items;
            document.getElementById('invStatExpiring').textContent = data.about_to_expire;
            document.getElementById('invStatExpired').textContent = data.expired;
            document.getElementById('invStatDispensed').textContent = data.dispensed;
            document.getElementById('invStatDiscarded').textContent = data.discarded;
        } catch (e) { /* ignore */ }
    }

    // --- Load Categories (for autocomplete) ---
    async function loadCategories() {
        try {
            var res = await fetch(window.API_BASE + '/api/medicines/categories');
            systemCategories = await res.json();
            
            // Setup filter autocomplete
            setupCategoryAutocomplete('invCategoryInput', 'invCategoryDropdown', systemCategories, function() {
                loadMedicines();
            });
            
            // Setup form autocomplete
            setupCategoryAutocomplete('medCategory', 'medCategoryDropdown', systemCategories);
            
        } catch (e) { /* ignore */ }
    }

    // --- Load Category Types (for filtering) ---
    async function loadCategoryTypes() {
        try {
            var res = await fetch(window.API_BASE + '/api/medicines/category-types');
            systemCategoryTypes = await res.json();
            setupCategoryAutocomplete('invCategoryTypeInput', 'invCategoryTypeDropdown', systemCategoryTypes, function() {
                loadMedicines();
            });
        } catch (e) { /* ignore */ }
    }

    // --- Genric Name Add Logic ---
    document.getElementById('addCategoryBtn').addEventListener('click', async function() {
        var newCat = document.getElementById('medCategory').value.trim();
        if (!newCat) {
            showToast('Please enter a generic name.', 'error');
            return;
        }

        var lowerCat = newCat.toLowerCase();
        var exists = systemCategories.find(c => c.toLowerCase() === lowerCat);
        
        if (exists) {
            openModal('duplicateCategoryModal');
        } else {
            await submitNewCategory(newCat);
        }
    });

    document.getElementById('dupCategoryAddBtn').addEventListener('click', async function() {
        var newCat = document.getElementById('medCategory').value.trim();
        closeModal('duplicateCategoryModal');
        await submitNewCategory(newCat);
    });

    async function submitNewCategory(catName) {
        try {
            var res = await fetch(window.API_BASE + '/api/medicines/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: catName })
            });
            if (res.ok) {
                showToast('Generic name added successfully.');
                loadCategories();
            } else {
                var data = await res.json();
                showToast(data.error || 'Failed to add generic name.', 'error');
            }
        } catch (e) {
            showToast('Connection error.', 'error');
        }
    }

    function setupCategoryAutocomplete(inputId, dropdownId, cats, onSelect) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if (!input || !dropdown) return;
        let debounce;

        input.addEventListener('input', function() {
            clearTimeout(debounce);
            const q = this.value.trim().toLowerCase();
            if (!q) { dropdown.classList.remove('show'); if(onSelect) onSelect(); return; }
            debounce = setTimeout(function() {
                const matches = cats.filter(c => c.toLowerCase().includes(q));
                if (!matches.length) { dropdown.classList.remove('show'); return; }
                dropdown.innerHTML = matches.map(c => `<div class="autocomplete-item" data-val="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join('');
                dropdown.classList.add('show');
                dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        input.value = el.dataset.val;
                        dropdown.classList.remove('show');
                        if (onSelect) onSelect();
                    });
                });
            }, 200);
        });
        input.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('show'), 200));
    }

    // --- Aggregated "Hidden Batch" Logic ---
    function aggregateMedicines(medicines) {
        var groups = {};
        medicines.forEach(m => {
            var baseStock = m.stock_number;
            var parts = m.stock_number.split('-');
            if (parts.length > 1 && !isNaN(parts[parts.length-1])) {
                baseStock = parts[0]; 
            }

            var key = m.article_name + '|' + (m.description_dosage || '') + '|' + m.unit_of_measurement + '|' + m.status;
            if (!groups[key]) {
                groups[key] = Object.assign({}, m);
                groups[key].stock_number = baseStock;
                groups[key].quantity = 0;
                groups[key].batches = [];
            }
            groups[key].quantity += m.quantity;
            var d1 = groups[key].expiration_date ? new Date(groups[key].expiration_date) : new Date(8640000000000000);
            var d2 = m.expiration_date ? new Date(m.expiration_date) : new Date(8640000000000000);
            if (d2 < d1) {
                groups[key].expiration_date = m.expiration_date;
                groups[key].days_remaining = m.days_remaining;
                groups[key].id = m.id; // representative ID
            }
            groups[key].batches.push(m);
        });
        return Object.values(groups);
    }

    function getOriginalStockNumber(stockNumber) {
        if (!stockNumber) return '';
        var parts = stockNumber.split('-');
        if (parts.length > 1) {
            var lastPart = parts[parts.length - 1];
            var secLastPart = parts[parts.length - 2];
            if (secLastPart && secLastPart.length === 8 && !isNaN(secLastPart) && !isNaN(lastPart)) {
                return parts.slice(0, parts.length - 2).join('-');
            }
            if (lastPart.length === 8 && !isNaN(lastPart)) {
                return parts.slice(0, parts.length - 1).join('-');
            }
        }
        return stockNumber;
    }

    // --- Load Medicines ---
    var aggregatedMedicines = [];
    var currentInventoryPage = 1;
    var inventoryPageSize = 10;

    window.changeInventoryPage = function(page) {
        currentInventoryPage = page;
        renderTable();
    };

    async function loadMedicines() {
        var params = new URLSearchParams();
        
        // Universal search
        var uSearch = document.getElementById('invUniversalSearch').value.trim();
        if (uSearch) params.set('search', uSearch);

        // Dynamic Filter
        var type = document.getElementById('invFilterType').value;
        if (type === 'status') {
            var s = document.getElementById('invStatusSelect').value;
            if (s) params.set('status', s);
        } else if (type === 'category') {
            var c = document.getElementById('invCategoryInput').value.trim();
            if (c) params.set('category', c);
        } else if (type === 'category_type') {
            var ct = document.getElementById('invCategoryTypeInput').value.trim();
            if (ct) params.set('category_type', ct);
        } else if (type === 'date_added') {
            var d = document.getElementById('invDateFilter').value;
            if (d) params.set('date_added', d);
        } else if (type === 'restocked_date') {
            var d2 = document.getElementById('invDateFilter').value;
            if (d2) params.set('restocked_date', d2);
        } else if (type === 'sort') {
            var sort = document.getElementById('invSortBy').value;
            params.set('sort', sort);
        }

        try {
            var res = await fetch(window.API_BASE + '/api/medicines?' + params.toString());
            allMedicines = await res.json();
            
            // --- Group by Original Batch ---
            var originalBatches = {};
            var orderKeys = [];
            var restockedBatches = [];

            allMedicines.forEach(function(m) {
                if (!m.is_restock) {
                    if (!originalBatches[m.stock_number]) {
                        orderKeys.push(m.stock_number);
                    }
                    originalBatches[m.stock_number] = Object.assign({}, m, {
                        original_quantity: m.quantity,
                        quantity: m.quantity,
                        batches: [m]
                    });
                } else {
                    restockedBatches.push(m);
                }
            });

            restockedBatches.forEach(function(r) {
                var parentStock = getOriginalStockNumber(r.stock_number);
                if (originalBatches[parentStock]) {
                    originalBatches[parentStock].quantity += r.quantity;
                    originalBatches[parentStock].batches.push(r);
                } else {
                    if (!originalBatches[r.stock_number]) {
                        orderKeys.push(r.stock_number);
                    }
                    originalBatches[r.stock_number] = Object.assign({}, r, {
                        original_quantity: r.quantity,
                        quantity: r.quantity,
                        batches: [r]
                    });
                }
            });

            aggregatedMedicines = orderKeys.map(function(key) { return originalBatches[key]; });
            currentInventoryPage = 1;
            renderTable();
        } catch (e) {
            document.getElementById('inventoryBody').innerHTML = '<tr class="empty-row"><td colspan="11">Failed to load inventory</td></tr>';
            document.getElementById('inventoryPagination').innerHTML = '';
        }
    }

    function renderTable() {
        var tbody = document.getElementById('inventoryBody');
        if (!aggregatedMedicines.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No medicines found</td></tr>';
            document.getElementById('inventoryPagination').innerHTML = '';
            return;
        }
        
        var pageData = window.paginateData(aggregatedMedicines, currentInventoryPage, inventoryPageSize);
        window.renderPagination('inventoryPagination', aggregatedMedicines.length, currentInventoryPage, inventoryPageSize, 'changeInventoryPage');

        tbody.innerHTML = pageData.map(function (m) {
            var actions = '<div class="actions">' +
                '<button class="btn btn-outline btn-sm" onclick="editMedicine(' + m.id + ')">Edit</button>' +
                '<button class="btn btn-yellow btn-sm" onclick="discardMedicine(' + m.id + ')">Discard</button>' +
                '<button class="btn btn-danger btn-sm" onclick="deleteMedicine(' + m.id + ')">Delete</button>' +
                '</div>';
            var daysHtml = '-';
            if (m.days_remaining !== null) {
                if (m.status === 'Expired') daysHtml = '<span style="color:var(--red);font-weight:700;">' + m.days_remaining + '</span>';
                else if (m.status === 'Near Expiry') daysHtml = '<span style="color:var(--orange);font-weight:700;">' + m.days_remaining + '</span>';
                else if (m.status === 'Active') daysHtml = '<span style="color:var(--primary);font-weight:700;">' + m.days_remaining + '</span>';
                else daysHtml = '<span style="color:var(--text);font-weight:700;">' + m.days_remaining + '</span>';
            }
            return '<tr style="cursor: pointer;" onclick="window.openMedicineBatchesModal(\'' + escapeHtml(m.stock_number) + '\', event)"><td>' + escapeHtml(m.stock_number) + '</td><td>' + escapeHtml(m.article_name) +
                '</td><td>' + escapeHtml(m.description_dosage) + '</td><td>' + escapeHtml(m.unit_of_measurement) +
                '</td><td>' + m.quantity +
                '</td><td>' + escapeHtml(m.category) + '</td><td>' + formatDate(m.expiration_date) +
                '</td><td>' + daysHtml + '</td><td>' + escapeHtml(m.remarks) + '</td><td>' + statusBadge(m.status) +
                '</td><td>' + actions + '</td></tr>';
        }).join('');
    }

    // --- Helper Functions for Medicine Batches ---
    window.openMedicineBatchesModal = function(stockNumber, event) {
        if (event && (event.target.closest('.actions') || event.target.closest('button'))) {
            return;
        }
        
        var group = aggregatedMedicines.find(function(g) { return g.stock_number === stockNumber; });
        if (!group) return;

        document.getElementById('batchInfoBrand').textContent = group.article_name || '-';
        document.getElementById('batchInfoDosage').textContent = group.description_dosage || '-';
        document.getElementById('batchInfoUnit').textContent = group.unit_of_measurement || '-';
        document.getElementById('batchInfoGeneric').textContent = group.category || '-';

        var tbody = document.getElementById('medBatchesTableBody');
        tbody.innerHTML = '';

        // Sort batches: original first, then by date/stock number
        var sortedBatches = group.batches.slice().sort(function(a, b) {
            if (!a.is_restock && b.is_restock) return -1;
            if (a.is_restock && !b.is_restock) return 1;
            return new Date(a.date_added) - new Date(b.date_added);
        });

        tbody.innerHTML = sortedBatches.map(function(m) {
            var isOriginal = !m.is_restock;
            var rowClass = isOriginal ? 'class="original-batch-row"' : '';
            
            var displayStock = m.stock_number;
            if (m.is_restock) {
                var parentStock = getOriginalStockNumber(m.stock_number);
                var parts = m.stock_number.split('-');
                var dateStr = parts[parts.length - 1];
                if (!isNaN(dateStr) && dateStr.length === 1 && parts.length > 2) {
                    dateStr = parts[parts.length - 2];
                }
                if (dateStr && dateStr.length === 8) {
                    var mm = dateStr.substring(0, 2);
                    var dd = dateStr.substring(2, 4);
                    var yyyy = dateStr.substring(4, 8);
                    displayStock = parentStock + ' - ' + mm + '/' + dd + '/' + yyyy;
                }
            } else {
                displayStock = '<span class="original-stock-badge">Original</span>' + escapeHtml(m.stock_number);
            }

            var daysHtml = '-';
            if (m.days_remaining !== null) {
                if (m.status === 'Expired') daysHtml = '<span style="color:var(--red);font-weight:700;">' + m.days_remaining + '</span>';
                else if (m.status === 'Near Expiry') daysHtml = '<span style="color:var(--orange);font-weight:700;">' + m.days_remaining + '</span>';
                else if (m.status === 'Active') daysHtml = '<span style="color:var(--primary);font-weight:700;">' + m.days_remaining + '</span>';
                else daysHtml = '<span style="color:var(--text);font-weight:700;">' + m.days_remaining + '</span>';
            }

            var actionHtml = 
                '<div class="batch-action-dropdown">' +
                    '<button class="btn btn-ghost btn-sm dropdown-trigger" onclick="window.toggleBatchActionMenu(' + m.id + ', event)" style="padding: 4px 8px; font-weight: bold; font-size: 1.1rem; border: none; background: none; cursor: pointer; color: var(--text-color);">⋮</button>' +
                    '<div id="batchActionMenu_' + m.id + '" class="batch-dropdown-menu">' +
                        '<button onclick="window.editMedicineBatch(' + m.id + ')">Edit</button>' +
                        '<button onclick="window.discardMedicineBatch(' + m.id + ')" style="color:var(--yellow);">Discard</button>' +
                        '<button onclick="window.deleteMedicineBatch(' + m.id + ')" style="color:var(--red);">Delete</button>' +
                    '</div>' +
                '</div>';

            return '<tr ' + rowClass + '>' +
                '<td>' + displayStock + '</td>' +
                '<td>' + m.quantity + '</td>' +
                '<td>' + formatDate(m.date_added) + '</td>' +
                '<td>' + formatDate(m.expiration_date) + '</td>' +
                '<td>' + daysHtml + '</td>' +
                '<td>' + statusBadge(m.status) + '</td>' +
                '<td>' + escapeHtml(m.remarks || '') + '</td>' +
                '<td style="overflow: visible;">' + actionHtml + '</td>' +
                '</tr>';
        }).join('');

        openModal('medBatchesModal');
    };

    window.toggleBatchActionMenu = function(id, event) {
        event.stopPropagation();
        var menu = document.getElementById('batchActionMenu_' + id);
        
        var dropdowns = document.querySelectorAll('.batch-dropdown-menu');
        dropdowns.forEach(function(d) {
            if (d !== menu) {
                d.style.display = 'none';
            }
        });
        
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
        } else {
            menu.style.display = 'block';
        }
    };

    window.editMedicineBatch = function(id) {
        closeModal('medBatchesModal');
        window.editMedicine(id);
    };

    window.discardMedicineBatch = function(id) {
        closeModal('medBatchesModal');
        window.discardMedicine(id, true);
    };

    window.deleteMedicineBatch = function(id) {
        closeModal('medBatchesModal');
        window.deleteMedicine(id, true);
    };

    // Close action menus if the user clicks anywhere else
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.batch-action-dropdown')) {
            var dropdowns = document.querySelectorAll('.batch-dropdown-menu');
            dropdowns.forEach(function(d) {
                d.style.display = 'none';
            });
        }
    });

    // --- Toolbar Event Listeners ---
    const invFilterType = document.getElementById('invFilterType');
    const invSearchWrapper = document.getElementById('invSearchWrapper');
    const invStatusWrapper = document.getElementById('invStatusWrapper');
    const invCategoryWrapper = document.getElementById('invCategoryWrapper');
    const invCategoryTypeWrapper = document.getElementById('invCategoryTypeWrapper');
    const invDateWrapper = document.getElementById('invDateWrapper');
    const invSortWrapper = document.getElementById('invSortWrapper');

    invFilterType.addEventListener('change', function() {
        const val = this.value;
        [invSearchWrapper, invStatusWrapper, invCategoryWrapper, invCategoryTypeWrapper, invDateWrapper, invSortWrapper].forEach(w => w.style.display = 'none');
        
        if (val === 'status') invStatusWrapper.style.display = 'block';
        else if (val === 'category') invCategoryWrapper.style.display = 'block';
        else if (val === 'category_type') invCategoryTypeWrapper.style.display = 'block';
        else if (val === 'date_added' || val === 'restocked_date') invDateWrapper.style.display = 'block';
        else if (val === 'sort') invSortWrapper.style.display = 'block';
        
        loadMedicines();
    });

    var debounceTimer;
    document.getElementById('invUniversalSearch').addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(loadMedicines, 400);
    });
    document.getElementById('invStatusSelect').addEventListener('change', loadMedicines);
    document.getElementById('invDateFilter').addEventListener('change', loadMedicines);
    document.getElementById('invSortBy').addEventListener('change', loadMedicines);

    // --- Export Dropdown ---
    var exportDropdown = document.getElementById('exportDropdown');
    document.getElementById('exportBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        exportDropdown.classList.toggle('show');
    });
    document.addEventListener('click', function () { exportDropdown.classList.remove('show'); });

    // --- Export ---
    document.getElementById('exportCsvBtn').addEventListener('click', function () {
        window.location.href = '/api/inventory/export/csv';
        exportDropdown.classList.remove('show');
    });
    document.getElementById('exportPdfBtn').addEventListener('click', function () {
        window.location.href = '/api/inventory/export/pdf';
        exportDropdown.classList.remove('show');
    });


    // --- Add Medicine Modal ---
    document.getElementById('addMedBtn').addEventListener('click', function () {
        resetMedForm();
        document.getElementById('medModalTitle').textContent = 'Add Medicine';
        document.getElementById('medSubmitBtn').textContent = 'Add Medicine';
        document.getElementById('medStock').disabled = false;
        document.getElementById('medQty').disabled = false;
        openModal('medModal');
    });

    function resetMedForm() {
        document.getElementById('medEditId').value = '';
        document.getElementById('medForm').reset();
    }

    // --- Submit Medicine ---
    document.getElementById('medSubmitBtn').addEventListener('click', async function () {
        submitMedicinePayload(false);
    });

    async function submitMedicinePayload(forceAdd) {
        var editId = document.getElementById('medEditId').value;
        var payload = {
            stock_number: document.getElementById('medStock').value.trim(),
            article_name: document.getElementById('medName').value.trim(),
            description_dosage: document.getElementById('medDosage').value.trim(),
            unit_of_measurement: document.getElementById('medUnit').value,
            category: document.getElementById('medCategory').value.trim(),
            category_type: document.getElementById('medCategoryType').value.trim(),
            expiration_date: document.getElementById('medExpDate').value,
            remarks: document.getElementById('medRemarks').value.trim()
        };
        
        if (!editId) {
            payload.quantity = document.getElementById('medQty').value;
        }

        if (!payload.stock_number || !payload.article_name || !payload.unit_of_measurement) {
            showToast('Please fill in required fields.', 'error');
            return;
        }

        if (!editId && !forceAdd) {
            var dup = allMedicines.find(function(m) {
                return m.stock_number.toLowerCase() === payload.stock_number.toLowerCase() &&
                       m.article_name.toLowerCase() === payload.article_name.toLowerCase();
            });
            if (dup) {
                window.duplicateMedicineFound = dup;
                openModal('duplicateMedModal');
                return;
            }
        }
        
        if (forceAdd) {
             payload.force_add = true;
        }

        try {
            var url = editId ? '/api/medicines/' + editId : '/api/medicines';
            var method = editId ? 'PUT' : 'POST';
            var res = await fetch(window.API_BASE + url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var data = await res.json();
            if (res.ok) {
                showToast(editId ? 'Medicine updated successfully.' : 'Medicine added successfully.');
                closeModal('medModal');
                loadMedicines();
                loadInvStats();
            } else {
                showToast(data.error || 'Failed to save medicine.', 'error');
            }
        } catch (e) {
            showToast('Connection error.', 'error');
        }
    }

    document.getElementById('dupAddBtn').addEventListener('click', function() {
        closeModal('duplicateMedModal');
        submitMedicinePayload(true);
    });

    document.getElementById('dupRestockBtn').addEventListener('click', function() {
        closeModal('duplicateMedModal');
        closeModal('medModal');
        
        var dup = window.duplicateMedicineFound;
        if (!dup) return;
        
        document.getElementById('restockMedSelect').innerHTML = '<option value="' + dup.id + '">' + dup.article_name + ' (' + dup.stock_number + ')</option>';
        document.getElementById('restockMedSelect').value = dup.id;
        document.getElementById('restockStock').value = dup.stock_number;
        document.getElementById('restockCategory').value = dup.category || '';
        document.getElementById('restockDosage').value = dup.description_dosage || '';
        document.getElementById('restockUnit').value = dup.unit_of_measurement;
        
        openModal('restockModal');
    });

    // --- Edit Medicine ---
    window.editMedicine = function (id) {
        var med = allMedicines.find(function (m) { return m.id === id; });
        if (!med) return;
        document.getElementById('medEditId').value = med.id;
        document.getElementById('medStock').value = med.stock_number;
        document.getElementById('medStock').disabled = true;
        document.getElementById('medName').value = med.article_name;
        document.getElementById('medDosage').value = med.description_dosage || '';
        document.getElementById('medUnit').value = med.unit_of_measurement;
        document.getElementById('medQty').value = med.quantity;
        document.getElementById('medQty').disabled = true;
        document.getElementById('medCategory').value = med.category || '';
        document.getElementById('medCategoryType').value = med.category_type || '';
        document.getElementById('medExpDate').value = med.expiration_date || '';
        document.getElementById('medRemarks').value = med.remarks || '';
        document.getElementById('medModalTitle').textContent = 'Edit Medicine';
        document.getElementById('medSubmitBtn').textContent = 'Update Medicine';
        openModal('medModal');
    };

    // --- Restock Medicine ---
    document.getElementById('restockMedBtn').addEventListener('click', function() {
        var sel = document.getElementById('restockMedSelect');
        sel.innerHTML = '<option value="">Choose medicine to restock...</option>';
        var activeMeds = allMedicines.filter(m => (m.status === 'Active' || m.status === 'Near Expiry' || m.status === 'Expired') && !m.is_restock);
        
        // Group available medicines by name to reduce clutter (optional but nice), but since uniqueness is by stock_number, we show unique items.
        // Wait, the prompt says "separate row in the inventory" doing restocking. So they pick from existing.
        activeMeds.forEach(function (m) {
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.article_name + ' (' + m.stock_number + ')';
            sel.appendChild(opt);
        });
        
        document.getElementById('restockForm').reset();
        document.getElementById('restockStock').value = '';
        document.getElementById('restockCategory').value = '';
        document.getElementById('restockDosage').value = '';
        document.getElementById('restockUnit').value = '';
        openModal('restockModal');
    });

    document.getElementById('restockMedSelect').addEventListener('change', function() {
        var medId = parseInt(this.value);
        var med = allMedicines.find(function (m) { return m.id === medId; });
        if (med) {
            document.getElementById('restockStock').value = med.stock_number;
            document.getElementById('restockCategory').value = med.category || '';
            document.getElementById('restockDosage').value = med.description_dosage || '';
            document.getElementById('restockUnit').value = med.unit_of_measurement;
        } else {
            document.getElementById('restockStock').value = '';
            document.getElementById('restockCategory').value = '';
            document.getElementById('restockDosage').value = '';
            document.getElementById('restockUnit').value = '';
        }
    });

    document.getElementById('restockSubmitBtn').addEventListener('click', async function() {
        var medId = document.getElementById('restockMedSelect').value;
        var qty = document.getElementById('restockQty').value;
        var expDate = document.getElementById('restockExpDate').value;
        
        if (!medId || !qty) {
            showToast('Please select a medicine and enter quantity.', 'error');
            return;
        }

        try {
            var res = await fetch(window.API_BASE + '/api/medicines/' + medId + '/restock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity: qty, expiration_date: expDate })
            });
            var data = await res.json();
            if (res.ok) {
                showToast('Medicine restocked successfully.');
                closeModal('restockModal');
                loadMedicines();
                loadInvStats();
            } else {
                showToast(data.error || 'Failed to restock.', 'error');
            }
        } catch (e) {
            showToast('Connection error.', 'error');
        }
    });

    // --- Discard Medicine ---
    window.discardMedicine = function (id, singleOnly) {
        var group = !singleOnly ? aggregatedMedicines.find(g => g.id === id) : null;
        if (group && group.batches) {
            document.getElementById('discardMedId').value = JSON.stringify(group.batches.map(b => b.id));
        } else {
            document.getElementById('discardMedId').value = JSON.stringify([id]);
        }
        document.getElementById('discardReason').value = '';
        openModal('discardModal');
    };
    document.getElementById('discardConfirmBtn').addEventListener('click', async function () {
        var ids = JSON.parse(document.getElementById('discardMedId').value);
        var reason = document.getElementById('discardReason').value.trim();
        if (!reason) { showToast('Please provide a reason.', 'error'); return; }
        try {
            var successCount = 0;
            for (var id of ids) {
                var res = await fetch(window.API_BASE + '/api/medicines/' + id + '/discard', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: reason })
                });
                if (res.ok) successCount++;
            }
            if (successCount > 0) {
                showToast('Medicine discarded successfully.');
                closeModal('discardModal');
                loadMedicines();
                loadInvStats();
            } else { showToast('Failed to discard.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Delete Medicine ---
    window.deleteMedicine = function (id, singleOnly) {
        var group = !singleOnly ? aggregatedMedicines.find(g => g.id === id) : null;
        if (group && group.batches) {
            document.getElementById('deleteMedId').value = JSON.stringify(group.batches.map(b => b.id));
        } else {
            document.getElementById('deleteMedId').value = JSON.stringify([id]);
        }
        document.getElementById('deleteReason').value = '';
        openModal('deleteModal');
    };
    document.getElementById('deleteConfirmBtn').addEventListener('click', async function () {
        var ids = JSON.parse(document.getElementById('deleteMedId').value);
        var reason = document.getElementById('deleteReason').value.trim();
        if (!reason) { showToast('Please provide a reason.', 'error'); return; }
        try {
            var successCount = 0;
            for (var id of ids) {
                var res = await fetch(window.API_BASE + '/api/medicines/' + id, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: reason })
                });
                if (res.ok) successCount++;
            }
            if (successCount > 0) {
                showToast('Medicine deleted successfully.');
                closeModal('deleteModal');
                loadMedicines();
                loadInvStats();
            } else { showToast('Failed to delete.', 'error'); }
        } catch (e) { showToast('Connection error.', 'error'); }
    });

    // --- Block Click Popups ---
    document.querySelectorAll('[data-block]').forEach(function (el) {
        el.addEventListener('click', function () {
            var type = this.dataset.block;
            showInvBlockPopup(type);
        });
    });

    var currentBlockPage = 1;
    var currentBlockData = [];
    var currentBlockType = '';
    
    window.changeInvBlockPage = function(page) {
        currentBlockPage = page;
        renderInvBlockTable();
    };

    function renderInvBlockTable() {
        var thead = document.getElementById('invBlockTableHead');
        var tbody = document.getElementById('invBlockTableBody');
        
        if (!currentBlockData.length) {
            if (currentBlockType === 'dispensed') {
                thead.innerHTML = '<tr><th>Dispenser</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Center</th><th>Date</th></tr>';
                tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No items</td></tr>';
            } else {
                thead.innerHTML = '<tr><th>Stock #</th><th>Article</th><th>Unit</th><th>Qty</th><th>Generic Name</th><th>Exp. Date</th><th>Days</th><th>Status</th></tr>';
                tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No items</td></tr>';
            }
            document.getElementById('invBlockPagination').innerHTML = '';
            return;
        }

        var pageData = window.paginateData(currentBlockData, currentBlockPage, 10);
        window.renderPagination('invBlockPagination', currentBlockData.length, currentBlockPage, 10, 'changeInvBlockPage');

        if (currentBlockType === 'dispensed') {
            thead.innerHTML = '<tr><th>Dispenser</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Center</th><th>Date</th></tr>';
            tbody.innerHTML = pageData.map(function (d) {
                return '<tr><td>' + escapeHtml(d.dispenser_name) + '</td><td>' + escapeHtml(d.medicine_name) +
                    '</td><td>' + d.quantity_dispensed + '</td><td>' + escapeHtml(d.recipient_name) +
                    '</td><td>' + escapeHtml(d.center_name) + '</td><td>' + formatDateTime(d.date_time) + '</td></tr>';
            }).join('');
        } else {
            thead.innerHTML = '<tr><th>Stock #</th><th>Article</th><th>Unit</th><th>Qty</th><th>Generic Name</th><th>Exp. Date</th><th>Days</th><th>Status</th></tr>';
            tbody.innerHTML = pageData.map(function (m) {
                var popDays = '-';
                if (m.days_remaining !== null) {
                    if (m.status === 'Expired') popDays = '<span style="color:var(--coral);font-weight:700;">' + m.days_remaining + '</span>';
                    else if (m.status === 'Near Expiry') popDays = '<span style="color:var(--yellow);font-weight:700;">' + m.days_remaining + '</span>';
                    else if (m.status === 'Active') popDays = '<span style="color:var(--primary);font-weight:700;">' + m.days_remaining + '</span>';
                    else popDays = '<span style="color:var(--text);font-weight:700;">' + m.days_remaining + '</span>';
                }
                return '<tr><td>' + escapeHtml(m.stock_number) + '</td><td>' + escapeHtml(m.article_name) +
                    '</td><td>' + escapeHtml(m.unit_of_measurement) + '</td><td>' + m.quantity + '</td><td>' +
                    escapeHtml(m.category) + '</td><td>' + formatDate(m.expiration_date) + '</td><td>' + popDays + '</td><td>' +
                    statusBadge(m.status) + '</td></tr>';
            }).join('');
        }
    }

    async function showInvBlockPopup(type) {
        var titles = {
            total: 'Total Items', about_to_expire: 'About to Expire',
            expired: 'Expired Items', dispensed: 'Dispensed Items', discarded: 'Discarded Items'
        };
        document.getElementById('invBlockModalTitle').textContent = titles[type] || 'Items';
        try {
            var res = await fetch(window.API_BASE + '/api/dashboard/block/' + type);
            var items = await res.json();
            
            currentBlockType = type;
            currentBlockData = items;
            currentBlockPage = 1;
            renderInvBlockTable();
            
            openModal('invBlockModal');
        } catch (e) { showToast('Failed to load data.', 'error'); }
    }

    // Init
    loadMedicines();
    loadInvStats();
    loadCategories();
    loadCategoryTypes();
})();
