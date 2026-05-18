# MediSync
### **Vitali Health District Medicine Inventory & Management System**

**MediSync** is a streamlined, web-based inventory management solution designed specifically for the **Vitali District Health Center**. It automates the tracking, categorization, and monitoring of medical supplies to ensure that essential medicines are always available for the community.

---

## Overview
Managing medicine in a barangay health center requires precision. **MediSync** replaces manual logging with a digital interface, allowing healthcare workers to manage stock levels, track expiration dates, and organize medicines by category with ease.

---

## Key Features
* **Medicine Inventory:** Real-time tracking of stock levels (In/Out) with barcode/stock number support.
* **Smart Categorization:** Organize items by Generic Name and an optional metadata "Category" (e.g., Pain Relief, Vitamins, Heart) for advanced filtering.
* **Team Accounts:** Admin can create up to **5 sub-accounts** for coworkers, each with full system access while maintaining individual activity logs.
* **Activity Monitoring:** Real-time logging of all actions (Add, Edit, Restock, Dispense) with a powerful filtering system per user/action.
* **Account Customization:** Profile management page with base64-encoded profile picture storage for cross-platform compatibility.
* **Automation:** Low stock and near-expiry detection with dashboard indicators and automated notifications.
* **Data Migration:** Built-in tools for PDF medicine list extraction and database schema updates.

---

## Tech Stack
| Component | Technology |
| :--- | :--- |
| **Backend** | Python (Flask) |
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla) |
| **Database** | SQLite (Local) / PostgreSQL (Production) |
| **Storage** | Base64-encoded persistent storage for profile images |
| **Tools** | ReportLab (PDF), SQLAlchemy ORM |

---

## Project Structure
```plaintext
├── app.py                # Main application entry point & API routes
├── models.py             # Database models (User, Medicine, ActivityLog, etc.)
├── templates/            # HTML pages (Dashboard, Inventory, Account, etc.)
├── static/               # Assets (CSS, JS, Images)
├── migrate_db.py         # DB migration & schema management script
├── extract_categories.py  # PDF data processing utility
└── vercel.json           # Configuration for cloud deployment
```

---

## Installation & Setup

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/keinndh/medisync.git
   cd medisync
   ```

2. **Create a Virtual Environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Initialize & Run the Database:**
   ```bash
   python app.py  # Automatically initializes and migrates schema
   ```

5. **Access the App:**
   > The app defaults to **[https://medisyncinventory.vercel.app/](https://medisyncinventory.vercel.app/)**.

---

## Future Roadmap (Next Steps)
* [x] **Sub-Account Management:** Allow admins to manage coworker access.
* [x] **Activity Monitoring:** Comprehensive logs for all system changes.
* [ ] **Advanced Reporting:** Detailed PDF/Excel exports for monthly district-level reports.
* [ ] **Auto-Backup:** Periodic database backups for data recovery.
* [ ] **Mobile App:** Potential mobile-first companion for easy dispensing on-field.

---

## Contributing
This project is dedicated to improving healthcare efficiency at the **Vitali District Health Center**. Feedback and pull requests are welcome.

---

## License
MIT License - &copy; 2026 MediSync.
