/* ===================================================================
   MediSync - Global Application JS
   Handles: real-time clock, notifications, logout, toasts, modals
   =================================================================== */

// --- Global API Configuration ---
// Ensure all fetch requests send cookies for cross-origin authentication
window.API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
  ? 'http://127.0.0.1:5000'
  : '';  // Same-origin on Vercel (Flask serves both frontend + API)

// --- Auto logout after 60 minutes of inactivity ---
(function() {
  var TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
  var inactivityTimer;

  function doLogout() {
    localStorage.removeItem('ms_auth_token');
    localStorage.removeItem('ms_user');
    window.location.href = '/login?reason=timeout';
  }

  function resetTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(doLogout, TIMEOUT_MS);
  }

  // Reset on any user activity
  ['click', 'mousemove', 'keydown', 'scroll', 'touchstart', 'mousedown'].forEach(function(evt) {
    document.addEventListener(evt, resetTimer, { passive: true, capture: true });
  });

  // Start timer on page load
  resetTimer();
})();



// Global fetch interceptor
// On production: API calls go through Netlify proxy (/api/*) — same-origin, cookies work everywhere
// On localhost: API calls go to 127.0.0.1:5000 — attach token header as fallback
const originalFetch = window.fetch;
window.fetch = function() {
    let [resource, config] = arguments;
    if (!config) config = {};

    // Always send cookies (works on desktop; on mobile the proxy makes it same-origin so cookies work too)
    if (config.credentials === undefined) config.credentials = 'include';

    // On localhost only: attach token header since there's no proxy
    const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    if (isLocalhost) {
        const token = localStorage.getItem('ms_auth_token');
        if (token && typeof resource === 'string' && resource.includes('127.0.0.1')) {
            if (!config.headers) config.headers = {};
            if (config.headers instanceof Headers) {
                if (!config.headers.has('X-Auth-Token')) config.headers.set('X-Auth-Token', token);
            } else {
                if (!config.headers['X-Auth-Token']) config.headers['X-Auth-Token'] = token;
            }
        }
    }

    return originalFetch(resource, config).then(function(response) {
        // 401 = session expired or token invalid — redirect to login
        if (response.status === 401 && typeof resource === 'string' && resource.includes('/api/')) {
            localStorage.removeItem('ms_auth_token');
            localStorage.removeItem('ms_user');
            window.location.href = '/login';
        }
        return response;
    });
};

// --- Real-time Clock ---
function updateClock() {
  const now = new Date();
  const dateEl = document.getElementById("headerDate");
  const timeEl = document.getElementById("headerTime");
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}
setInterval(updateClock, 1000);
updateClock();

// --- Load User Info ---
async function loadUserInfo() {
  // Show cached user instantly (avoids blank name on slow connections)
  const cached = localStorage.getItem('ms_user');
  if (cached) {
    try {
      const u = JSON.parse(cached);
      const nameEl = document.getElementById("headerUserName");
      if (nameEl) nameEl.textContent = u.full_name || u.username || 'Admin';
      // Also show cached profile picture immediately
      const picEl = document.getElementById("headerProfilePic");
      if (picEl && u.profile_picture) {
        let picUrl = u.profile_picture;
        if (picUrl.startsWith('/')) picUrl = window.API_BASE + picUrl;
        picEl.innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">';
      }
    } catch(e) {}
  }

  try {
    const res = await fetch(window.API_BASE + "/api/me");
    if (!res.ok) return;
    const user = await res.json();
    // Update cache
    localStorage.setItem('ms_user', JSON.stringify(user));
    const nameEl = document.getElementById("headerUserName");
    if (nameEl) nameEl.textContent = user.full_name || user.username;
    const picEl = document.getElementById("headerProfilePic");
    if (picEl && user.profile_picture) {
      // Supports both base64 data URLs and legacy /static/uploads/ paths
      let picUrl = user.profile_picture;
      if (picUrl.startsWith('/')) picUrl = window.API_BASE + picUrl;
      picEl.innerHTML = '<img src="' + picUrl + '" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">';
    }
  } catch (e) {
    /* ignore */
  }
}
loadUserInfo();

// --- Notifications ---
let notifOpen = false;

async function loadNotifications() {
  try {
    const res = await fetch(window.API_BASE + "/api/notifications");
    if (!res.ok) return;
    const notifs = await res.json();
    const badge = document.getElementById("notifBadge");
    const unread = notifs.filter((n) => !n.is_read).length;
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "flex" : "none";
    }
    renderNotifications(notifs);
  } catch (e) {
    /* ignore */
  }
}

function renderNotifications(notifs) {
  const list = document.getElementById("notifList");
  if (!list) return;
  if (notifs.length === 0) {
    list.innerHTML =
      '<div class="empty-state" style="padding:32px;"><div class="empty-title">No notifications</div></div>';
    return;
  }
  list.innerHTML = notifs
    .map((n) => {
      const date = new Date(n.created_at);
      const timeAgo = getTimeAgo(date);
      return (
        '<div class="notif-item ' +
        (n.is_read ? "" : "unread") +
        '" data-id="' +
        n.id +
        '">' +
        '<div class="notif-dot ' +
        n.type +
        '"></div>' +
        '<div><div class="notif-text">' +
        escapeHtml(n.message) +
        "</div>" +
        '<div class="notif-time">' +
        timeAgo +
        "</div></div></div>"
      );
    })
    .join("");
}

function getTimeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

const notifBtn = document.getElementById("notifBtn");
const notifPopup = document.getElementById("notifPopup");
if (notifBtn && notifPopup) {
  notifBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    notifOpen = !notifOpen;
    notifPopup.classList.toggle("show", notifOpen);
  });
  document.addEventListener("click", function (e) {
    if (
      notifOpen &&
      !notifPopup.contains(e.target) &&
      !notifBtn.contains(e.target)
    ) {
      notifOpen = false;
      notifPopup.classList.remove("show");
    }
  });
}

const markAllBtn = document.getElementById("markAllReadBtn");
if (markAllBtn) {
  markAllBtn.addEventListener("click", async function () {
    await fetch(window.API_BASE + "/api/notifications/read-all", { method: "PUT" });
    loadNotifications();
  });
}

loadNotifications();
setInterval(loadNotifications, 30000);

// --- Logout ---
const logoutTriggers = document.querySelectorAll("#sidebarLogout");
const logoutModal = document.getElementById("logoutModal");
const logoutNo = document.getElementById("logoutNo");
const logoutYes = document.getElementById("logoutYes");

logoutTriggers.forEach(function (el) {
  el.addEventListener("click", function (e) {
    e.preventDefault();
    if (logoutModal) logoutModal.classList.add("show");
  });
});
if (logoutNo)
  logoutNo.addEventListener("click", function () {
    logoutModal.classList.remove("show");
  });
if (logoutYes) {
  logoutYes.addEventListener("click", async function () {
    await fetch(window.API_BASE + "/api/logout", { method: "POST" });
    localStorage.removeItem('ms_auth_token');
    localStorage.removeItem('ms_user');
    window.location.href = "/login";
  });
}

// --- Sidebar Toggle ---
const sidebarToggleBtn = document.getElementById("sidebarToggle");
const appLayout = document.querySelector(".app-layout");
const mobileToggle = document.getElementById("hamburgerMenu");
const sidebar = document.querySelector(".sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function isTabletWidth() {
  return window.innerWidth > 768 && window.innerWidth <= 1024;
}

if (sidebarToggleBtn && appLayout) {
  sidebarToggleBtn.addEventListener("click", function () {
    if (isTabletWidth()) {
      // At tablet/half-screen: toggle "expanded" class (default is collapsed)
      appLayout.classList.toggle("expanded");
      localStorage.setItem("sidebarExpanded", appLayout.classList.contains("expanded"));
    } else {
      // At full desktop: toggle "collapsed" class (default is expanded)
      appLayout.classList.toggle("collapsed");
      localStorage.setItem("sidebarCollapsed", appLayout.classList.contains("collapsed"));
    }
  });
}

// Restore sidebar state on load
(function() {
  if (isTabletWidth()) {
    if (localStorage.getItem("sidebarExpanded") === "true") {
      appLayout && appLayout.classList.add("expanded");
    }
  } else {
    if (localStorage.getItem("sidebarCollapsed") === "true") {
      appLayout && appLayout.classList.add("collapsed");
    }
  }
})();

// Handle resize — switch modes cleanly
window.addEventListener("resize", function() {
  if (!appLayout) return;
  if (window.innerWidth <= 768) {
    appLayout.classList.remove("collapsed", "expanded");
  } else if (isTabletWidth()) {
    appLayout.classList.remove("collapsed");
    if (localStorage.getItem("sidebarExpanded") === "true") appLayout.classList.add("expanded");
  } else {
    appLayout.classList.remove("expanded");
    if (localStorage.getItem("sidebarCollapsed") === "true") appLayout.classList.add("collapsed");
  }
});

if (mobileToggle && sidebar && sidebarOverlay) {
  mobileToggle.addEventListener("click", function () {
    sidebar.classList.add("mobile-open");
    sidebarOverlay.classList.add("active");
  });
  sidebarOverlay.addEventListener("click", function () {
    sidebar.classList.remove("mobile-open");
    sidebarOverlay.classList.remove("active");
  });
  // Also close when a link is clicked
  sidebar.querySelectorAll(".sidebar-nav a").forEach(link => {
    link.addEventListener("click", () => {
      sidebar.classList.remove("mobile-open");
      sidebarOverlay.classList.remove("active");
    });
  });
}

// --- Modal Utility ---
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("show");
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("show");
}

// --- Toast Utility ---
function showToast(message, type) {
  type = type || "success";
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className =
    "toast" +
    (type === "error" ? " error" : type === "warning" ? " warning" : "");
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    setTimeout(function () {
      toast.remove();
    }, 300);
  }, 3500);
}

// --- Global Utilities ---
window.escapeHtml = function (str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

window.formatDate = function (dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

window.formatDateTime = function (dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// --- Badge HTML ---
function statusBadge(status) {
  var cls = "badge-active";
  if (status === "Expired") cls = "badge-expired";
  else if (status === "Near Expiry") cls = "badge-near-expiry";
  else if (status === "Discarded") cls = "badge-discarded";
  else if (status === "Pending") cls = "badge-pending";
  else if (status === "Fulfilled") cls = "badge-fulfilled";
  return '<span class="badge ' + cls + '">' + escapeHtml(status) + "</span>";
}
window.statusBadge = statusBadge;

// --- Pagination Utility ---
window.paginateData = function(data, page, pageSize) {
    var start = (page - 1) * pageSize;
    return data.slice(start, start + pageSize);
};

window.renderPagination = function(containerId, totalItems, currentPage, pageSize, onPageChangeName) {
    var totalPages = Math.ceil(totalItems / pageSize);
    var container = document.getElementById(containerId);
    if (!container) return;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    var html = '<div class="pagination" style="display:flex; justify-content:center; gap:4px; margin-top:16px;">';
    html += '<button class="btn btn-sm btn-outline ' + (currentPage === 1 ? 'disabled' : '') + '" onclick="if(' + currentPage + '>1) window.' + onPageChangeName + '(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>Prev</button>';
    
    for (var i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += '<button class="btn btn-sm ' + (i === currentPage ? 'btn-primary' : 'btn-outline') + '" onclick="window.' + onPageChangeName + '(' + i + ')">' + i + '</button>';
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += '<span style="padding: 4px 8px;">...</span>';
        }
    }
    
    html += '<button class="btn btn-sm btn-outline ' + (currentPage === totalPages ? 'disabled' : '') + '" onclick="if(' + currentPage + '<' + totalPages + ') window.' + onPageChangeName + '(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + '>Next</button>';
    html += '</div>';
    container.innerHTML = html;
};

// --- Remove Preload Transition Lock ---
window.addEventListener("load", function () {
  document.body.classList.remove("preload");
});
