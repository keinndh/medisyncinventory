/* MediSync - Dashboard JS */
(function () {
    // --- Carousel ---
    var currentSlide = 0;
    var totalSlides = 5;
    var track = document.getElementById('carouselTrack');
    var dots = document.querySelectorAll('.carousel-dot');

    function goToSlide(index) {
        if (index < 0) index = totalSlides - 1;
        if (index >= totalSlides) index = 0;
        currentSlide = index;
        track.style.transform = 'translateX(-' + (currentSlide * 100) + '%)';
        dots.forEach(function (d, i) {
            d.classList.toggle('active', i === currentSlide);
        });
    }

    document.getElementById('carouselPrev').addEventListener('click', function () { goToSlide(currentSlide - 1); });
    document.getElementById('carouselNext').addEventListener('click', function () { goToSlide(currentSlide + 1); });
    dots.forEach(function (dot) {
        dot.addEventListener('click', function () { goToSlide(parseInt(this.dataset.index)); });
    });

    // Auto-slide
    var autoSlide = setInterval(function () { goToSlide(currentSlide + 1); }, 5000);
    var wrapper = document.querySelector('.carousel-wrapper');
    if (wrapper) {
        wrapper.addEventListener('mouseenter', function () { clearInterval(autoSlide); });
        wrapper.addEventListener('mouseleave', function () {
            autoSlide = setInterval(function () { goToSlide(currentSlide + 1); }, 5000);
        });
    }

    // --- Load Stats ---
    async function loadStats() {
        try {
            var res = await fetch(window.API_BASE + '/api/dashboard/stats');
            var data = await res.json();
            document.getElementById('statTotal').textContent = data.total_items;
            document.getElementById('statExpiring').textContent = data.about_to_expire;
            document.getElementById('statExpired').textContent = data.expired;
            document.getElementById('statDispensed').textContent = data.dispensed;
            document.getElementById('statDiscarded').textContent = data.discarded;
        } catch (e) { /* ignore */ }
    }

    // --- Block Click -> Popup ---
    document.querySelectorAll('.stat-block').forEach(function (block) {
        block.addEventListener('click', function () {
            var type = this.dataset.block;
            showBlockPopup(type);
        });
    });

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
            }
            groups[key].quantity += m.quantity;
            var d1 = groups[key].expiration_date ? new Date(groups[key].expiration_date) : new Date(8640000000000000);
            var d2 = m.expiration_date ? new Date(m.expiration_date) : new Date(8640000000000000);
            if (d2 < d1) {
                groups[key].expiration_date = m.expiration_date;
                groups[key].days_remaining = m.days_remaining;
            }
        });
        return Object.values(groups);
    }

    var currentBlockPage = 1;
    var currentBlockData = [];
    var currentBlockType = '';
    
    window.changeDashboardBlockPage = function(page) {
        currentBlockPage = page;
        renderBlockTable();
    };

    function renderBlockTable() {
        var thead = document.getElementById('blockTableHead');
        var tbody = document.getElementById('blockTableBody');

        if (!currentBlockData.length) {
            if (currentBlockType === 'dispensed') {
                thead.innerHTML = '<tr><th>Dispenser</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Center</th><th>Date</th></tr>';
                tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No items found</td></tr>';
            } else {
                thead.innerHTML = '<tr><th>Stock #</th><th>Article</th><th>Unit</th><th>Qty</th><th>Generic Name</th><th>Exp. Date</th><th>Status</th></tr>';
                tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No items found</td></tr>';
            }
            document.getElementById('blockPagination').innerHTML = '';
            return;
        }

        var pageData = window.paginateData(currentBlockData, currentBlockPage, 10);
        window.renderPagination('blockPagination', currentBlockData.length, currentBlockPage, 10, 'changeDashboardBlockPage');

        if (currentBlockType === 'dispensed') {
            thead.innerHTML = '<tr><th>Dispenser</th><th>Medicine</th><th>Qty</th><th>Recipient</th><th>Center</th><th>Date</th></tr>';
            tbody.innerHTML = pageData.map(function (d) {
                return '<tr><td>' + escapeHtml(d.dispenser_name) + '</td><td>' + escapeHtml(d.medicine_name) +
                    '</td><td>' + d.quantity_dispensed + '</td><td>' + escapeHtml(d.recipient_name) +
                    '</td><td>' + escapeHtml(d.center_name) + '</td><td>' + formatDateTime(d.date_time) + '</td></tr>';
            }).join('');
        } else {
            thead.innerHTML = '<tr><th>Stock #</th><th>Article</th><th>Unit</th><th>Qty</th><th>Generic Name</th><th>Exp. Date</th><th>Status</th></tr>';
            tbody.innerHTML = pageData.map(function (m) {
                return '<tr><td>' + escapeHtml(m.stock_number) + '</td><td>' + escapeHtml(m.article_name) +
                    '</td><td>' + escapeHtml(m.unit_of_measurement) + '</td><td>' + m.quantity +
                    '</td><td>' + escapeHtml(m.category) + '</td><td>' + formatDate(m.expiration_date) +
                    '</td><td>' + statusBadge(m.status) + '</td></tr>';
            }).join('');
        }
    }

    async function showBlockPopup(type) {
        var titles = {
            total: 'Total Items', about_to_expire: 'About to Expire',
            expired: 'Expired Items', dispensed: 'Dispensed Items', discarded: 'Discarded Items'
        };
        document.getElementById('blockModalTitle').textContent = titles[type] || 'Items';

        try {
            var res = await fetch(window.API_BASE + '/api/dashboard/block/' + type);
            var items = await res.json();
            
            currentBlockType = type;
            currentBlockData = items;
            currentBlockPage = 1;
            renderBlockTable();
            openModal('blockModal');
        } catch (e) { showToast('Failed to load data', 'error'); }
    }

    // --- Recently Added Table ---
    async function loadRecent() {
        try {
            var res = await fetch(window.API_BASE + '/api/dashboard/recent');
            var items = await res.json();
            var tbody = document.getElementById('recentBody');
            if (!items.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No recent medicines</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(function (m) {
                var batchStatus = m.is_restock ? '<span class="badge badge-edited">Restocked</span>' : (m.is_new_batch ? '<span class="badge badge-created">Created</span>' : '<span class="badge badge-edited">Edited</span>');
                return '<tr><td>' + escapeHtml(m.stock_number) + '</td><td>' + escapeHtml(m.article_name) +
                    '</td><td>' + escapeHtml(m.description_dosage) + '</td><td>' + escapeHtml(m.unit_of_measurement) +
                    '</td><td>' + m.quantity +
                    '</td><td>' + escapeHtml(m.category) + '</td><td>' + formatDateTime(m.date_added) +
                    '</td><td>' + batchStatus + '</td></tr>';
            }).join('');
        } catch (e) {
            document.getElementById('recentBody').innerHTML = '<tr class="empty-row"><td colspan="9">Failed to load data</td></tr>';
        }
    }

    // --- Load Expired ---
    var expiredData = [];
    var expiredPage = 1;
    
    window.changeExpiredPage = function(page) {
        expiredPage = page;
        renderExpired();
    };

    function renderExpired() {
        var tbody = document.getElementById('expiredBody');
        if (!expiredData.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No expired medicines</td></tr>';
            document.getElementById('expiredPagination').innerHTML = '';
            return;
        }
        
        var pageData = window.paginateData(expiredData, expiredPage, 10);
        window.renderPagination('expiredPagination', expiredData.length, expiredPage, 10, 'changeExpiredPage');

        tbody.innerHTML = pageData.map(function (m) {
            var days = m.days_remaining !== null ? m.days_remaining : '-';
            return '<tr><td>' + escapeHtml(m.article_name) + '</td><td>' + escapeHtml(m.category) +
                '</td><td>' + escapeHtml(m.unit_of_measurement) + '</td><td>' + m.quantity +
                '</td><td>' + formatDate(m.expiration_date) + '</td><td style="color:var(--coral);font-weight:700;">' + days +
                '</td><td>' + statusBadge(m.status) + '</td></tr>';
        }).join('');
    }

    async function loadExpired() {
        try {
            var res = await fetch(window.API_BASE + '/api/analytics/expired');
            var items = await res.json();
            document.getElementById('expiredCount').textContent = items.length;
            expiredData = items;
            expiredPage = 1;
            renderExpired();
        } catch (e) { /* ignore */ }
    }

    // --- Load About to Expire ---
    var expiringData = [];
    var expiringPage = 1;

    window.changeExpiringPage = function(page) {
        expiringPage = page;
        renderExpiring();
    };

    function renderExpiring() {
        var tbody = document.getElementById('expiringBody');
        if (!expiringData.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No medicines about to expire</td></tr>';
            document.getElementById('expiringPagination').innerHTML = '';
            return;
        }

        var pageData = window.paginateData(expiringData, expiringPage, 10);
        window.renderPagination('expiringPagination', expiringData.length, expiringPage, 10, 'changeExpiringPage');

        tbody.innerHTML = pageData.map(function (m) {
            var days = m.days_remaining !== null ? m.days_remaining : '-';
            return '<tr><td>' + escapeHtml(m.article_name) + '</td><td>' + escapeHtml(m.category) +
                '</td><td>' + escapeHtml(m.unit_of_measurement) + '</td><td>' + m.quantity +
                '</td><td>' + formatDate(m.expiration_date) + '</td><td style="color:var(--yellow);font-weight:700;">' + days +
                '</td><td>' + statusBadge(m.status) + '</td></tr>';
        }).join('');
    }

    async function loadExpiring() {
        try {
            var res = await fetch(window.API_BASE + '/api/analytics/expiring');
            var items = await res.json();
            document.getElementById('expiringCount').textContent = items.length;
            expiringData = items;
            expiringPage = 1;
            renderExpiring();
        } catch (e) { /* ignore */ }
    }

    // --- Pie Chart ---
    async function loadChart() {
        try {
            var res = await fetch(window.API_BASE + '/api/analytics/status-chart');
            var data = await res.json();
            drawPieChart(data);
        } catch (e) { /* ignore */ }
    }

    function drawPieChart(data) {
        var canvas = document.getElementById('statusChart');
        if(!canvas) return;
        var ctx = canvas.getContext('2d');
        var total = data.values.reduce(function (a, b) { return a + b; }, 0);
        var cx = canvas.width / 2;
        var cy = canvas.height / 2;
        var radius = Math.min(cx, cy) - 10;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (total === 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = '#E2E2EA';
            ctx.fill();
            ctx.fillStyle = '#9999AD';
            ctx.font = '600 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', cx, cy);
            return;
        }

        var startAngle = -Math.PI / 2;
        data.values.forEach(function (val, i) {
            if (val === 0) return;
            var sliceAngle = (val / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fillStyle = data.colors[i];
            ctx.fill();

            // Label
            var midAngle = startAngle + sliceAngle / 2;
            var labelR = radius * 0.65;
            var lx = cx + labelR * Math.cos(midAngle);
            var ly = cy + labelR * Math.sin(midAngle);
            var pct = Math.round((val / total) * 100);
            if (pct > 5) {
                ctx.fillStyle = '#fff';
                ctx.font = '700 13px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pct + '%', lx, ly);
            }

            startAngle += sliceAngle;
        });

        // Inner circle (donut)
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.fillStyle = '#2B2B43';
        ctx.font = '800 20px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(total, cx, cy - 8);
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillStyle = '#9999AD';
        ctx.fillText('Total', cx, cy + 12);

        // Legend
        var legend = document.getElementById('chartLegend');
        legend.innerHTML = data.labels.map(function (label, i) {
            return '<div class="legend-item"><div class="legend-color" style="background:' + data.colors[i] +
                '"></div>' + label + '<span class="legend-value">(' + data.values[i] + ')</span></div>';
        }).join('');
    }

    loadStats();
    loadRecent();
    loadExpired();
    loadExpiring();
    loadChart();
})();
