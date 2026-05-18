import os
import io
import csv
import secrets
import random
from datetime import datetime, date, timedelta, timezone
from functools import wraps

from flask import (
    Flask, render_template, request, jsonify, session,
    redirect, url_for, send_file, make_response
)
from werkzeug.utils import secure_filename
from models import db, User, Medicine, Center, Dispensing, RequestQueue, ActivityLog, Notification, Recipient, MedicineCategory, AuthToken

from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

MANILA_TZ = timezone(timedelta(hours=8))

def manila_now():
    return datetime.now(MANILA_TZ).replace(tzinfo=None)

def manila_today():
    return manila_now().date()

def generate_serial_number():
    """Generates a unique 10-digit serial number."""
    while True:
        sn = ''.join([str(random.randint(0, 9)) for _ in range(10)])
        if not Dispensing.query.filter_by(serial_number=sn).first():
            return sn

# app configuration
# Explicitly set paths so Flask finds static/ and templates/ from root
# regardless of where the entry point (api/index.py) is located
_root = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__,
            static_folder=os.path.join(_root, 'static'),
            template_folder=os.path.join(_root, 'templates'))
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'medisync-dev-key')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'static', 'uploads')

database_url = os.getenv('DATABASE_URL')
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

if not database_url:
    # Fallback for build step — runtime will always have DATABASE_URL set via env vars
    database_url = 'sqlite:///fallback.db'
    print("WARNING: DATABASE_URL not set — using SQLite fallback. Set DATABASE_URL in Vercel env vars.")

app.config['SQLALCHEMY_DATABASE_URI'] = database_url

from models import db 
db.init_app(app)

app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_NAME'] = 'ms_session'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 60 minutes inactivity timeout

# Use /tmp for uploads on Vercel (only writable directory in serverless)
VERCEL = os.getenv('VERCEL', False)
if VERCEL:
    app.config['UPLOAD_FOLDER'] = '/tmp/uploads'

try:
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
except Exception:
    pass

def init_db():
    """Initialize DB tables — called on startup."""
    try:
        db.create_all()
        # Migrate existing tables: add new columns if missing
        from sqlalchemy import inspect, text
        insp = inspect(db.engine)
        # Medicine: category_type
        med_cols = [c['name'] for c in insp.get_columns('medicines')]
        if 'category_type' not in med_cols:
            db.session.execute(text("ALTER TABLE medicines ADD COLUMN category_type VARCHAR(200) DEFAULT ''"))
            db.session.commit()
            print('Migrated: added category_type to medicines')
        # User: role, parent_id
        user_cols = [c['name'] for c in insp.get_columns('users')]
        if 'role' not in user_cols:
            db.session.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'admin'"))
            db.session.commit()
            print('Migrated: added role to users')
        if 'parent_id' not in user_cols:
            db.session.execute(text("ALTER TABLE users ADD COLUMN parent_id INTEGER REFERENCES users(id)"))
            db.session.commit()
            print('Migrated: added parent_id to users')
        # User: profile_picture (in case old DB lacks it)
        if 'profile_picture' not in user_cols:
            db.session.execute(text("ALTER TABLE users ADD COLUMN profile_picture TEXT DEFAULT ''"))
            db.session.commit()
            print('Migrated: added profile_picture to users')
        if not User.query.filter_by(username='admin').first():
            u = User(username='admin', full_name='System Admin', role='admin')
            u.set_password('admin123')
            db.session.add(u)
            db.session.commit()
            print("Default admin created successfully.")
        else:
            print("DB init OK — admin already exists.")
    except Exception as e:
        import traceback
        print(f"DB init error: {e}")
        print(traceback.format_exc())
        db.session.rollback()

# Initialize on startup (works for both local and Vercel)
with app.app_context():
    init_db()

# Allow credentials for cross-origin Netlify requests
# CORS: add your Vercel URL to origins once deployed (e.g. https://medisync.vercel.app)
CORS(app,
     supports_credentials=True,
     origins=[
         'https://medisync-inventory.netlify.app',
         'https://medisyncinventory.onrender.com',
         os.getenv('FRONTEND_URL', ''),          # Set this in Vercel env vars
         'http://127.0.0.1:5000',
         'http://localhost:5000',
         'http://localhost:3000',
     ],
     allow_headers=['Content-Type', 'Authorization', 'X-Auth-Token'],
     expose_headers=['X-Auth-Token']
)

# helpers
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # Try token header first (mobile-friendly, avoids cross-site cookie issues)
        token = request.headers.get('X-Auth-Token') or request.args.get('auth_token')
        if token:
            auth = AuthToken.query.filter_by(token=token).first()
            if auth:
                request.current_user_id = auth.user_id
                return f(*args, **kwargs)
        # Fall back to session cookie (desktop browsers)
        if 'user_id' in session:
            request.current_user_id = session['user_id']
            return f(*args, **kwargs)
        if request.is_json or request.path.startswith('/api/'):
            return jsonify({'error': 'Unauthorized'}), 401
        return redirect(url_for('login_page'))
    return decorated


def log_activity(action, details=''):
    uid = getattr(request, 'current_user_id', None) or session.get('user_id')
    user = User.query.get(uid)
    performed_by = user.full_name if user else 'System'
    if user and user.role == 'sub' and user.parent:
        performed_by = f"{user.full_name} (sub of {user.parent.full_name})"
    entry = ActivityLog(action=action, performed_by=performed_by, details=details)
    db.session.add(entry)
    db.session.commit()


def add_notification(message, notif_type='info', reference_id=None, reference_type=''):
    n = Notification(
        message=message, type=notif_type,
        reference_id=reference_id, reference_type=reference_type
    )
    db.session.add(n)
    db.session.commit()


def check_expirations():
    """Check medicines for expiration and create notifications."""
    today = manila_today()
    near_expiry_threshold = today + timedelta(days=180)  # 6 months
    medicines = Medicine.query.filter(
        Medicine.status.in_(['Active', 'Near Expiry']),
        Medicine.expiration_date.isnot(None)
    ).all()
    for med in medicines:
        if med.expiration_date <= today and med.status in ['Active', 'Near Expiry']:
            med.status = 'Expired'
            add_notification(
                f'{med.article_name} (Stock #{med.stock_number}) has expired.',
                'alert', med.id, 'medicine'
            )
        elif med.expiration_date <= near_expiry_threshold and med.status == 'Active':
            med.status = 'Near Expiry'
            existing = Notification.query.filter_by(
                reference_id=med.id, reference_type='medicine_expiring'
            ).first()
            if not existing:
                days = (med.expiration_date - today).days
                add_notification(
                    f'{med.article_name} (Stock #{med.stock_number}) expires in {days} days.',
                    'warning', med.id, 'medicine_expiring'
                )
    db.session.commit()




@app.route('/api/setup')
def api_setup():
    """One-time setup endpoint — creates tables and default admin if missing."""
    try:
        db.create_all()
        if not User.query.filter_by(username='admin').first():
            u = User(username='admin', full_name='System Admin')
            u.set_password('admin123')
            db.session.add(u)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Admin user created. Username: admin, Password: admin123'})
        else:
            return jsonify({'success': True, 'message': 'Admin already exists. Tables OK.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# pages routes 
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))
    return redirect(url_for('login_page'))


@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard_page'))
    return render_template('login.html')


@app.route('/dashboard')
@login_required
def dashboard_page():
    check_expirations()
    return render_template('dashboard.html')


@app.route('/inventory')
@login_required
def inventory_page():
    return render_template('inventory.html')
@app.route('/inventory/print')
@login_required
def inventory_print():
    medicines = Medicine.query.filter(Medicine.status != 'Deleted').order_by(Medicine.date_added.desc()).all()
    return render_template('inventory_print.html', medicines=medicines, current_date=manila_today().strftime("%B %d, %Y"))



@app.route('/dispensing')
@login_required
def dispensing_page():
    return render_template('dispensing.html')


@app.route('/centers')
@login_required
def centers_page():
    return render_template('centers.html')


@app.route('/logs')
@login_required
def logs_page():
    return render_template('logs.html')


@app.route('/account')
@login_required
def account_page():
    return render_template('account.html')

# Keep old route for backward compatibility
@app.route('/settings')
@login_required
def settings_page():
    return redirect(url_for('account_page'))


# auth api
@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    username = data.get('username', '')
    password = data.get('password', '')
    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        session.permanent = True
        session['user_id'] = user.id
        # Save token to DB — safe for serverless (no in-memory state)
        token = secrets.token_hex(32)
        auth_token = AuthToken(token=token, user_id=user.id)
        db.session.add(auth_token)
        db.session.commit()
        log_activity('Login', f'User {user.username} logged in.')
        return jsonify({'success': True, 'user': user.to_dict(), 'token': token})
    return jsonify({'success': False, 'error': 'Invalid username or password.'}), 401


@app.route('/api/logout', methods=['POST'])
@login_required
def api_logout():
    log_activity('Logout', 'User logged out.')
    session.clear()
    # Delete token from DB
    token = request.headers.get('X-Auth-Token')
    if token:
        AuthToken.query.filter_by(token=token).delete()
        db.session.commit()
    return jsonify({'success': True})


@app.route('/api/me')
@login_required
def api_me():
    user = User.query.get(getattr(request, 'current_user_id', session.get('user_id')))
    return jsonify(user.to_dict())


# dasboard api
@app.route('/api/dashboard/stats')
@login_required
def api_dashboard_stats():
    today = manila_today()
    near_expiry_threshold = today + timedelta(days=180)
    total = Medicine.query.filter(Medicine.status.in_(['Active', 'Near Expiry', 'Expired'])).count()
    expired = Medicine.query.filter_by(status='Expired').count()
    about_to_expire = Medicine.query.filter(
        Medicine.status.in_(['Active', 'Near Expiry']),
        Medicine.expiration_date.isnot(None),
        Medicine.expiration_date <= near_expiry_threshold,
        Medicine.expiration_date > today
    ).count()
    dispensed = Dispensing.query.count()
    discarded = Medicine.query.filter_by(status='Discarded').count()
    return jsonify({
        'total_items': total,
        'about_to_expire': about_to_expire,
        'expired': expired,
        'dispensed': dispensed,
        'discarded': discarded
    })


@app.route('/api/dashboard/block/<block_type>')
@login_required
def api_dashboard_block(block_type):
    today = manila_today()
    near_expiry_threshold = today + timedelta(days=180)
    items = []
    if block_type == 'total':
        items = [m.to_dict() for m in Medicine.query.filter(Medicine.status.in_(['Active', 'Near Expiry', 'Expired'])).all()]
    elif block_type == 'about_to_expire':
        items = [m.to_dict() for m in Medicine.query.filter(
            Medicine.status.in_(['Active', 'Near Expiry']),
            Medicine.expiration_date.isnot(None),
            Medicine.expiration_date <= near_expiry_threshold,
            Medicine.expiration_date > today
        ).all()]
    elif block_type == 'expired':
        items = [m.to_dict() for m in Medicine.query.filter_by(status='Expired').all()]
    elif block_type == 'dispensed':
        items = [d.to_dict() for d in Dispensing.query.order_by(Dispensing.date_time.desc()).all()]
    elif block_type == 'discarded':
        items = [m.to_dict() for m in Medicine.query.filter_by(status='Discarded').all()]
    return jsonify(items)


@app.route('/api/dashboard/recent')
@login_required
def api_dashboard_recent():
    medicines = Medicine.query.order_by(Medicine.date_added.desc()).limit(20).all()
    return jsonify([m.to_dict() for m in medicines])


# inventory api
@app.route('/api/medicines')
@login_required
def api_medicines():
    query = Medicine.query.filter(Medicine.status != 'Deleted')

    # Universal search - searches across all fields
    search = request.args.get('search', '')
    if search:
        query = query.filter(
            db.or_(
                Medicine.article_name.ilike(f'%{search}%'),
                Medicine.stock_number.ilike(f'%{search}%'),
                Medicine.unit_of_measurement.ilike(f'%{search}%'),
                Medicine.status.ilike(f'%{search}%'),
                Medicine.category.ilike(f'%{search}%'),
                Medicine.category_type.ilike(f'%{search}%'),
                Medicine.description_dosage.ilike(f'%{search}%'),
                Medicine.remarks.ilike(f'%{search}%')
            )
        )

    # filtering
    status_filter = request.args.get('status', '')
    if status_filter:
        query = query.filter_by(status=status_filter)
    category_filter = request.args.get('category', '')
    if category_filter:
        query = query.filter_by(category=category_filter)
    category_type_filter = request.args.get('category_type', '')
    if category_type_filter:
        query = query.filter(Medicine.category_type.ilike(f'%{category_type_filter}%'))
    date_filter = request.args.get('date_added', '')
    if date_filter:
        try:
            filter_date = datetime.strptime(date_filter, '%Y-%m-%d').date()
            query = query.filter(db.func.date(Medicine.date_added) == filter_date)
        except ValueError:
            pass

    restocked_filter = request.args.get('restocked_date', '')
    if restocked_filter:
        try:
            filter_date = datetime.strptime(restocked_filter, '%Y-%m-%d').date()
            query = query.filter(Medicine.is_restock == True, db.func.date(Medicine.date_added) == filter_date)
        except ValueError:
            pass

    # sorting
    sort_by = request.args.get('sort', 'date_added')
    if sort_by == 'quantity':
        query = query.order_by(Medicine.quantity.desc())
    elif sort_by == 'alphabetical':
        query = query.order_by(Medicine.article_name.asc())
    elif sort_by == 'stock_number':
        query = query.order_by(Medicine.stock_number.asc())
    else:
        query = query.order_by(Medicine.date_added.desc())

    medicines = query.all()
    return jsonify([m.to_dict() for m in medicines])


@app.route('/api/medicines', methods=['POST'])
@login_required
def api_add_medicine():
    data = request.get_json()
    exp_date = None
    if data.get('expiration_date'):
        try:
            exp_date = datetime.strptime(data['expiration_date'], '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid expiration date format.'}), 400

    stock_num = data.get('stock_number', '')
    existing = Medicine.query.filter_by(stock_number=stock_num).first()
    if existing:
        if data.get('force_add'):
            import time
            stock_num = f"{stock_num}-NEW-{int(time.time())}"
        else:
            return jsonify({'error': 'Stock number already exists.'}), 400

    status = 'Active'
    if exp_date:
        if exp_date <= manila_today():
            status = 'Expired'
        elif exp_date <= manila_today() + timedelta(days=180):
            status = 'Near Expiry'

    med = Medicine(
        stock_number=stock_num,
        article_name=data.get('article_name', ''),
        description_dosage=data.get('description_dosage', ''),
        unit_of_measurement=data.get('unit_of_measurement', ''),
        quantity=int(data.get('quantity', 0)),
        category=data.get('category', ''),
        category_type=data.get('category_type', ''),
        remarks=data.get('remarks', ''),
        expiration_date=exp_date,
        is_new_batch=True,
        status=status
    )
    db.session.add(med)
    db.session.commit()
    log_activity('Add', f'Added medicine: {med.article_name} (Stock #{med.stock_number})')
    add_notification(f'New medicine added: {med.article_name}', 'info', med.id, 'medicine')
    return jsonify(med.to_dict()), 201


@app.route('/api/medicines/<int:med_id>', methods=['PUT'])
@login_required
def api_edit_medicine(med_id):
    med = Medicine.query.get_or_404(med_id)
    data = request.get_json()

    old_qty = med.quantity
    med.article_name = data.get('article_name', med.article_name)
    med.description_dosage = data.get('description_dosage', med.description_dosage)
    med.unit_of_measurement = data.get('unit_of_measurement', med.unit_of_measurement)
    med.quantity = int(data.get('quantity', med.quantity))
    med.category = data.get('category', med.category)
    med.category_type = data.get('category_type', med.category_type)
    med.remarks = data.get('remarks', med.remarks)

    if data.get('expiration_date'):
        try:
            exp_date = datetime.strptime(data['expiration_date'], '%Y-%m-%d').date()
            med.expiration_date = exp_date
            if med.status in ['Active', 'Near Expiry', 'Expired']:
                if exp_date <= manila_today():
                    med.status = 'Expired'
                elif exp_date <= manila_today() + timedelta(days=180):
                    med.status = 'Near Expiry'
                else:
                    med.status = 'Active'
        except ValueError:
            pass

    med.is_new_batch = False
    action = 'Edit'
    details = f'Edited medicine: {med.article_name} (Stock #{med.stock_number})'

    db.session.commit()
    log_activity(action, details)
    return jsonify(med.to_dict())


@app.route('/api/medicines/<int:med_id>/restock', methods=['POST'])
@login_required
def api_restock_medicine(med_id):
    old_med = Medicine.query.get_or_404(med_id)
    data = request.get_json()
    
    qty = int(data.get('quantity', 0))
    if qty <= 0:
        return jsonify({'error': 'Invalid quantity.'}), 400

    exp_date = None
    if data.get('expiration_date'):
        try:
            exp_date = datetime.strptime(data['expiration_date'], '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid expiration date format.'}), 400

    status = 'Active'
    if exp_date:
        if exp_date <= manila_today():
            status = 'Expired'
        elif exp_date <= manila_today() + timedelta(days=180):
            status = 'Near Expiry'

    # generate stock number for restocked: original-MMDDYYYY
    restock_date_str = manila_today().strftime('%m%d%Y')
    new_stock_number = f"{old_med.stock_number}-{restock_date_str}"
    # if same date restock already exists, append counter
    counter = 0
    while Medicine.query.filter_by(stock_number=new_stock_number).first():
        counter += 1
        new_stock_number = f"{old_med.stock_number}-{restock_date_str}-{counter}"

    new_med = Medicine(
        stock_number=new_stock_number,
        article_name=old_med.article_name,
        description_dosage=old_med.description_dosage,
        unit_of_measurement=old_med.unit_of_measurement,
        quantity=qty,
        category=old_med.category,
        category_type=old_med.category_type,
        remarks=old_med.remarks,
        expiration_date=exp_date,
        is_new_batch=False,
        is_restock=True,
        status=status
    )
    
    db.session.add(new_med)
    db.session.commit()
    
    log_activity('Restock', f'Restocked medicine: {new_med.article_name} (New Stock #{new_med.stock_number}) with {qty} {new_med.unit_of_measurement}')
    add_notification(f'Medicine restocked: {new_med.article_name}', 'info', new_med.id, 'medicine')
    
    return jsonify(new_med.to_dict()), 201


@app.route('/api/medicines/<int:med_id>/discard', methods=['POST'])
@login_required
def api_discard_medicine(med_id):
    med = Medicine.query.get_or_404(med_id)
    data = request.get_json()
    reason = data.get('reason', '')
    med.status = 'Discarded'
    med.discard_reason = reason
    db.session.commit()
    log_activity('Discard', f'Discarded medicine: {med.article_name}. Reason: {reason}')
    add_notification(f'Medicine discarded: {med.article_name}', 'warning', med.id, 'medicine')
    return jsonify(med.to_dict())


@app.route('/api/medicines/<int:med_id>', methods=['DELETE'])
@login_required
def api_delete_medicine(med_id):
    med = Medicine.query.get_or_404(med_id)
    data = request.get_json() or {}
    reason = data.get('reason', '')
    med.status = 'Deleted'
    med.delete_reason = reason
    db.session.commit()
    log_activity('Delete', f'Deleted medicine: {med.article_name}. Reason: {reason}')
    return jsonify({'success': True})


@app.route('/api/medicines/categories')
@login_required
def api_categories():
    # Categories from existing medicine records
    med_cats = db.session.query(Medicine.category).distinct().filter(
        Medicine.category != '', Medicine.category.isnot(None)
    ).all()
    med_cat_list = [c[0] for c in med_cats]
    
    # Categories from the imported/system list
    system_cats = MedicineCategory.query.all()
    system_cat_list = [c.name for c in system_cats]
    
    # Merge and deduplicate
    all_cats = sorted(list(set(med_cat_list + system_cat_list)))
    return jsonify(all_cats)


@app.route('/api/medicines/category-types')
@login_required
def api_category_types():
    """Get distinct category_type values for filtering."""
    cats = db.session.query(Medicine.category_type).distinct().filter(
        Medicine.category_type != '', Medicine.category_type.isnot(None)
    ).all()
    return jsonify(sorted([c[0] for c in cats]))


@app.route('/api/medicines/categories', methods=['POST'])
@login_required
def api_add_category():
    data = request.get_json()
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Category name is required.'}), 400
        
    existing = MedicineCategory.query.filter(db.func.lower(MedicineCategory.name) == name.lower()).first()
    if not existing:
        cat = MedicineCategory(name=name)
        db.session.add(cat)
        db.session.commit()
        return jsonify(cat.to_dict()), 201
    return jsonify(existing.to_dict()), 200


# export api
@app.route('/api/inventory/export/csv')
@login_required
def api_export_csv():
    medicines = Medicine.query.filter(Medicine.status != 'Deleted').order_by(Medicine.date_added.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'Stock Number', 'Article/Name', 'Description/Dosage', 'Unit of Measurement',
        'Quantity', 'Category', 'Expiration Date', 'Days To Expire', 'Status', 'Remarks', 'Date Added'
    ])
    for m in medicines:
        writer.writerow([
            m.stock_number, m.article_name, m.description_dosage, m.unit_of_measurement,
            m.quantity, m.category,
            m.expiration_date.isoformat() if m.expiration_date else '',
            m.to_dict().get('days_remaining') if m.to_dict().get('days_remaining') is not None else '-',
            m.status, m.remarks,
            m.date_added.strftime('%Y-%m-%d %H:%M') if m.date_added else ''
        ])
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'medisync_inventory_{manila_today().isoformat()}.csv'
    )


@app.route('/api/inventory/export/pdf')
@login_required
def api_export_pdf():
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    import os

    medicines = Medicine.query.filter(Medicine.status != 'Deleted').order_by(Medicine.date_added.desc()).all()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=0.5*inch, leftMargin=0.5*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('StockTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=14, alignment=TA_CENTER, spaceAfter=6)
    subtitle_style = ParagraphStyle('StockSubtitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=12, alignment=TA_CENTER, spaceAfter=24)
    
    elements = []

    img_path = os.path.join(app.static_folder, 'images', 'print_header.png')
    if os.path.exists(img_path):
        elements.append(Image(img_path, width=10*inch, height=0.975*inch))
        elements.append(Spacer(1, 0.1*inch))

    elements.append(Paragraph('MEDICAL SUPPLIES STOCK ASSESSMENT REPORT', title_style))
    elements.append(Paragraph(f'AS OF: {manila_today().strftime("%B %d, %Y")}', subtitle_style))

    headers = ['Stock Number', 'Article', 'Dosage', 'Unit', 'Qty.', 'Category', 'Expiration Date', 'Days Left', 'Status']
    data = [headers]
    for m in medicines:
        data.append([
            m.stock_number, m.article_name, m.description_dosage or '', m.unit_of_measurement,
            str(m.quantity), m.category or '',
            m.expiration_date.strftime('%Y-%m-%d') if m.expiration_date else '',
            str(m.to_dict().get('days_remaining')) if m.to_dict().get('days_remaining') is not None else '-',
            m.status
        ])

    # Calculate column widths to fit landscape A4
    col_widths = [1*inch, 1.8*inch, 1.2*inch, 0.8*inch, 0.6*inch, 1.2*inch, 1*inch, 0.7*inch, 0.9*inch]

    table = Table(data, repeatRows=1, colWidths=col_widths)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0284c7')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 0.6 * inch))

    # Add signature section
    sig_data = [
        ['Approved By:', '', 'Certified Correct By:'],
        ['\n\n\n', '', '\n\n\n'],
        ['Signature Over Printed Name of Head of Agency/Entity\nof Authorized Representative', '', 'Signature Over Printed Name of Inventor Committee\nChair and Members']
    ]
    
    sig_table = Table(sig_data, colWidths=[3.5*inch, 2*inch, 3.5*inch])
    sig_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (2, 0), (2, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('LINEBELOW', (0, 1), (0, 1), 1, colors.black),
        ('LINEBELOW', (2, 1), (2, 1), 1, colors.black),
    ]))
    
    elements.append(sig_table)

    doc.build(elements)
    buffer.seek(0)
    return send_file(
        buffer, mimetype='application/pdf', as_attachment=True,
        download_name=f'medisync_inventory_{manila_today().isoformat()}.pdf'
    )

# dipensing api
@app.route('/api/dispense', methods=['POST'])
@login_required
def api_dispense():
    data = request.get_json()
    article_name = data.get('article_name')
    if not article_name:
        return jsonify({'error': 'Article name is required.'}), 400

    # 1. Get all available stock for this medicine (FEFO order)
    batches = Medicine.query.filter(
        Medicine.article_name == article_name,
        Medicine.status.in_(['Active', 'Near Expiry'])
    ).order_by(Medicine.expiration_date.asc().nulls_last(), Medicine.date_added.asc()).all()

    if not batches:
        return jsonify({'error': 'Medicine not found or out of stock.'}), 404

    total_stock = sum(b.quantity for b in batches)
    
    # 2. Determine requested quantity (Manual Batches vs. Auto)
    selected_batches = data.get('selected_batches', [])
    is_manual = len(selected_batches) > 0
    
    if is_manual:
        requested_qty = sum(b.get('qty', 0) for b in selected_batches)
    else:
        requested_qty = int(data.get('quantity', 0))

    if requested_qty <= 0:
        return jsonify({'error': 'Invalid quantity.'}), 400

    # 3. Check for Low/Insufficient Stock Trigger
    confirm_action = data.get('confirm_action')
    if not confirm_action:
        # Trigger modal if requesting more than available OR more than half of total stock
        if requested_qty > total_stock or requested_qty >= (total_stock // 2):
            half_qty = max(0, total_stock // 2)
            queue_qty = requested_qty - half_qty
            return jsonify({
                'requires_confirmation': True,
                'message': f'Requested {requested_qty}, but stock is low ({total_stock} total). Dispense half ({half_qty}) and queue the remaining {queue_qty}?'
            }), 200

    # 4. Handle Logic based on Confirmation Action
    dispense_limit = requested_qty
    queue_qty = 0

    if confirm_action == 'queue_all':
        dispense_limit = 0
        queue_qty = requested_qty
    elif confirm_action == 'dispense_all':
        dispense_limit = min(requested_qty, total_stock)
    elif confirm_action == 'queue_remaining':
        dispense_limit = min(requested_qty, total_stock // 2)
        queue_qty = requested_qty - dispense_limit
    elif confirm_action == 'cancel_remaining':
        dispense_limit = min(requested_qty, total_stock // 2)

    # 5. Execute Deductions
    remaining_to_deduct = dispense_limit
    last_disp_id = None
    
    # If manual, we iterate through user choices. If auto, we use FEFO batches.
    source_items = selected_batches if is_manual else batches

    for item in source_items:
        if remaining_to_deduct <= 0: break
        
        # Get actual DB record
        b = Medicine.query.get(item['id']) if is_manual else item
        if not b or b.quantity <= 0: continue
        
        # Determine how much to take from this batch
        available_in_batch = item['qty'] if is_manual else b.quantity
        deduct = min(remaining_to_deduct, available_in_batch)
        
        if deduct > 0:
            b.quantity -= deduct
            remaining_to_deduct -= deduct
            
            disp = Dispensing(
                dispenser_name=data.get('dispenser_name', ''),
                medicine_id=b.id,
                recipient_name=data.get('recipient_name', ''),
                recipient_contact=data.get('recipient_contact', ''),
                center_id=data.get('center_id'),
                quantity_dispensed=deduct,
                remarks=f"{data.get('remarks', '')} ({confirm_action or 'Full'})".strip(),
                serial_number=generate_serial_number()
            )
            db.session.add(disp)
            db.session.flush()
            last_disp_id = disp.id

    # 6. Handle Queueing
    if queue_qty > 0:
        # Use the first available batch as a reference for the queue item
        primary_med = batches[0]
        q = RequestQueue(
            dispenser_name=data.get('dispenser_name', ''),
            medicine_id=primary_med.id,
            recipient_name=data.get('recipient_name', ''),
            recipient_contact=data.get('recipient_contact', ''),
            center_id=data.get('center_id'),
            quantity_requested=queue_qty,
            status='Pending'
        )
        db.session.add(q)

    db.session.commit()
    
    # 7. Final Response and Notifications
    log_activity('Dispense', f'Processed {article_name} (Dispensed: {dispense_limit}, Queued: {queue_qty})')
    
    # Check low stock threshold for notification
    final_total = sum(bb.quantity for bb in Medicine.query.filter(
        Medicine.article_name == article_name, Medicine.status.in_(['Active', 'Near Expiry'])
    ).all())
    if final_total < 100:
        add_notification(f'Low stock alert: {article_name} has only {final_total} units left.', 'warning')

    return jsonify({
        'success': True, 
        'queued': queue_qty > 0, 
        'message': f'Successfully processed request for {article_name}.'
    }), 201


@app.route('/api/dispense/today')
@login_required
def api_dispense_today():
    today_start = datetime.combine(manila_today(), datetime.min.time())
    items = Dispensing.query.filter(Dispensing.date_time >= today_start).order_by(Dispensing.date_time.desc()).all()
    return jsonify([d.to_dict() for d in items])


@app.route('/api/dispense/history')
@login_required
def api_dispense_history():
    query = Dispensing.query

    search = request.args.get('search', '')
    if search:
        query = query.join(Medicine).outerjoin(Center).filter(
            db.or_(
                Dispensing.recipient_name.ilike(f'%{search}%'),
                Medicine.article_name.ilike(f'%{search}%'),
                Center.name.ilike(f'%{search}%')
            )
        )

    date_filter = request.args.get('date', '')
    if date_filter:
        try:
            d = datetime.strptime(date_filter, '%Y-%m-%d').date()
            query = query.filter(db.func.date(Dispensing.date_time) == d)
        except ValueError:
            pass

    items = query.order_by(Dispensing.date_time.desc()).all()
    return jsonify([d.to_dict() for d in items])


@app.route('/api/dispense/<int:disp_id>/receipt')
@login_required
def api_dispense_receipt(disp_id):
    from reportlab.lib.pagesizes import A6
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER

    disp = Dispensing.query.get_or_404(disp_id)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A6, topMargin=10*mm, bottomMargin=10*mm, leftMargin=8*mm, rightMargin=8*mm)
    styles = getSampleStyleSheet()
    center_style = ParagraphStyle('center', parent=styles['Normal'], alignment=TA_CENTER, fontSize=8)
    title_style = ParagraphStyle('title_c', parent=styles['Title'], alignment=TA_CENTER, fontSize=12)
    small = ParagraphStyle('small', parent=styles['Normal'], fontSize=7)

    elements = []
    elements.append(Paragraph('MediSync', title_style))
    elements.append(Paragraph('Medicine Dispensing Receipt', center_style))
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width='100%', thickness=0.5, color=colors.grey))
    elements.append(Spacer(1, 2*mm))

    info = [
        ['Receipt #:', str(disp.id)],
        ['Serial #:', disp.serial_number or 'N/A'],
        ['Date/Time:', disp.date_time.strftime('%Y-%m-%d %H:%M') if disp.date_time else ''],
        ['Dispenser:', disp.dispenser_name],
        ['Medicine:', disp.medicine.article_name if disp.medicine else ''],
        ['Stock #:', disp.medicine.stock_number if disp.medicine else ''],
        ['Quantity:', str(disp.quantity_dispensed)],
        ['Recipient:', disp.recipient_name],
        ['Contact:', disp.recipient_contact or ''],
        ['Center:', disp.center.name if disp.center else 'N/A'],
    ]
    t = Table(info, colWidths=[25*mm, 45*mm])
    t.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width='100%', thickness=0.5, color=colors.grey))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(f'Remarks: {disp.remarks or "N/A"}', small))

    doc.build(elements)
    buffer.seek(0)
    return send_file(
        buffer, mimetype='application/pdf', as_attachment=True,
        download_name=f'receipt_{disp.id}.pdf'
    )


# queue
@app.route('/api/queue')
@login_required
def api_queue():
    items = RequestQueue.query.filter_by(status='Pending').order_by(
        RequestQueue.priority.desc(), RequestQueue.created_at.asc()
    ).all()
    return jsonify([q.to_dict() for q in items])


@app.route('/api/queue/<int:q_id>/prioritize', methods=['PUT'])
@login_required
def api_queue_prioritize(q_id):
    item = RequestQueue.query.get_or_404(q_id)
    max_p = db.session.query(db.func.max(RequestQueue.priority)).scalar() or 0
    item.priority = max_p + 1
    db.session.commit()
    log_activity('Edit', f'Prioritized queue item #{q_id} for {item.recipient_name}')
    return jsonify(item.to_dict())


@app.route('/api/queue/<int:q_id>/unprioritize', methods=['PUT'])
@login_required
def api_queue_unprioritize(q_id):
    item = RequestQueue.query.get_or_404(q_id)
    item.priority = 0
    db.session.commit()
    log_activity('Edit', f'Removed priority for queue item #{q_id} for {item.recipient_name}')
    return jsonify(item.to_dict())


@app.route('/api/queue/<int:q_id>', methods=['DELETE'])
@login_required
def api_queue_delete(q_id):
    item = RequestQueue.query.get_or_404(q_id)
    recipient = item.recipient_name
    medicine = item.medicine.article_name if item.medicine else 'Unknown'
    db.session.delete(item)
    db.session.commit()
    log_activity('Delete', f'Removed queue request #{q_id} for {recipient} ({medicine})')
    return jsonify({'success': True})


@app.route('/api/queue/<int:q_id>/fulfill', methods=['PUT'])
@login_required
def api_queue_fulfill(q_id):
    item = RequestQueue.query.get_or_404(q_id)
    original_med = Medicine.query.get(item.medicine_id)
    if not original_med:
        return jsonify({'error': 'Original medicine not found.'}), 404

    batches = Medicine.query.filter(
        Medicine.article_name == original_med.article_name,
        Medicine.status.in_(['Active', 'Near Expiry'])
    ).order_by(Medicine.expiration_date.asc().nulls_last(), Medicine.date_added.asc()).all()

    total_stock = sum(b.quantity for b in batches)

    # Fulfillment logic: only allowed if quantity_requested is <= half of total_stock
    limit = total_stock / 2
    if item.quantity_requested > limit:
        return jsonify({'error': f'Cannot fulfill: queued quantity ({item.quantity_requested}) must be half or less of the total available stock ({total_stock}). Current limit: {int(limit)}. Please restock first.'}), 400

    if total_stock >= item.quantity_requested:
        remaining_qty = item.quantity_requested
        first_disp_id = None
        for b in batches:
            if remaining_qty <= 0: break
            if b.quantity <= 0: continue
            deduct = min(remaining_qty, b.quantity)
            b.quantity -= deduct
            remaining_qty -= deduct
            
            disp = Dispensing(
                dispenser_name=item.dispenser_name,
                medicine_id=b.id,
                recipient_name=item.recipient_name,
                recipient_contact=item.recipient_contact,
                center_id=item.center_id,
                quantity_dispensed=deduct,
                remarks='Fulfilled from queue'
            )
            db.session.add(disp)
            db.session.flush()
            if not first_disp_id:
                first_disp_id = disp.id

        item.status = 'Fulfilled'
        item.fulfilled_at = manila_now()
        db.session.commit()
        log_activity('Dispense', f'Fulfilled queue request #{q_id}: {item.quantity_requested}x {original_med.article_name} to {item.recipient_name}')
        return jsonify({'success': True, 'message': 'Queue request fulfilled.', 'dispense_id': first_disp_id})
    else:
        return jsonify({'error': f'Still insufficient stock. Total available: {total_stock}'}), 400


# analytics api
@app.route('/api/analytics/expired')
@login_required
def api_analytics_expired():
    medicines = Medicine.query.filter(
        Medicine.expiration_date.isnot(None),
        Medicine.expiration_date <= manila_today(),
        Medicine.status.in_(['Expired', 'Discarded', 'Active', 'Near Expiry'])
    ).all()
    return jsonify([m.to_dict() for m in medicines])


@app.route('/api/analytics/expiring')
@login_required
def api_analytics_expiring():
    today = manila_today()
    threshold = today + timedelta(days=30)
    medicines = Medicine.query.filter(
        Medicine.status.in_(['Active', 'Near Expiry']),
        Medicine.expiration_date.isnot(None),
        Medicine.expiration_date > today,
        Medicine.expiration_date <= threshold
    ).all()
    return jsonify([m.to_dict() for m in medicines])


@app.route('/api/analytics/status-chart')
@login_required
def api_analytics_status_chart():
    active = Medicine.query.filter_by(status='Active').count()
    near_expiry = Medicine.query.filter_by(status='Near Expiry').count()
    expired = Medicine.query.filter_by(status='Expired').count()
    discarded = Medicine.query.filter_by(status='Discarded').count()
    dispensed = Dispensing.query.count()
    return jsonify({
        'labels': ['Active', 'Near Expiry', 'Expired', 'Discarded', 'Dispensed'],
        'values': [active, near_expiry, expired, discarded, dispensed],
        'colors': ['#5CB9A4', '#F4B938', '#FC6F5D', '#9e9e9e', '#2B2B43']
    })


# centers api
@app.route('/api/centers')
@login_required
def api_centers():
    centers = Center.query.order_by(Center.name.asc()).all()
    return jsonify([c.to_dict() for c in centers])


@app.route('/api/centers', methods=['POST'])
@login_required
def api_add_center():
    data = request.get_json()
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Center name is required.'}), 400
    existing = Center.query.filter_by(name=name).first()
    if existing:
        return jsonify({'error': 'Center already exists.'}), 400
    c = Center(name=name)
    db.session.add(c)
    db.session.commit()
    log_activity('Add', f'Added center: {name}')
    return jsonify(c.to_dict()), 201

@app.route('/api/centers/<int:center_id>', methods=['PUT'])
@login_required
def api_edit_center(center_id):
    c = Center.query.get_or_404(center_id)
    data = request.get_json()
    new_name = data.get('name', '').strip()
    if not new_name:
        return jsonify({'error': 'Center name is required.'}), 400
    if Center.query.filter(Center.name == new_name, Center.id != center_id).first():
        return jsonify({'error': 'Center name already exists.'}), 400
    old_name = c.name
    c.name = new_name
    db.session.commit()
    log_activity('Edit', f'Renamed center "{old_name}" to "{new_name}"')
    return jsonify(c.to_dict())

@app.route('/api/centers/<int:center_id>', methods=['DELETE'])
@login_required
def api_delete_center(center_id):
    c = Center.query.get_or_404(center_id)
    center_name = c.name
    
    for disp in c.dispensings:
        disp.center_id = None
    for q in c.queue_items:
        q.center_id = None
        
    db.session.delete(c)
    db.session.commit()
    log_activity('Delete', f'Deleted center: {center_name}')
    return jsonify({'success': True})


@app.route('/api/centers/<int:center_id>/transactions')
@login_required
def api_center_transactions(center_id):
    dispensings = Dispensing.query.filter_by(center_id=center_id).order_by(Dispensing.date_time.desc()).all()
    queued = RequestQueue.query.filter_by(center_id=center_id).order_by(RequestQueue.created_at.desc()).all()
    return jsonify({
        'dispensings': [d.to_dict() for d in dispensings],
        'queued': [q.to_dict() for q in queued]
    })


# recipients api
@app.route('/api/recipients')
@login_required
def api_recipients():
    search = request.args.get('q', '')
    center_id = request.args.get('center_id', '')
    query = Recipient.query
    if search:
        query = query.filter(Recipient.name.ilike(f'%{search}%'))
    if center_id:
        query = query.filter_by(center_id=int(center_id))
    recipients = query.order_by(Recipient.name.asc()).all()
    return jsonify([r.to_dict() for r in recipients])


@app.route('/api/recipients', methods=['POST'])
@login_required
def api_add_recipient():
    data = request.get_json()
    name = data.get('name', '').strip()
    contact = data.get('contact', '').strip()
    center_id = data.get('center_id')
    if not name or not center_id:
        return jsonify({'error': 'Name and center are required.'}), 400
    # Check for duplicate in same center
    existing = Recipient.query.filter_by(name=name, center_id=center_id).first()
    if existing:
        return jsonify({'error': f'Recipient "{name}" already exists in this center.'}), 400
    r = Recipient(name=name, contact=contact, center_id=center_id)
    db.session.add(r)
    db.session.commit()
    log_activity('Add', f'Saved recipient profile: {name}')
    return jsonify(r.to_dict()), 201


@app.route('/api/recipients/<int:r_id>', methods=['DELETE'])
@login_required
def api_delete_recipient(r_id):
    r = Recipient.query.get_or_404(r_id)
    name = r.name
    db.session.delete(r)
    db.session.commit()
    log_activity('Delete', f'Deleted recipient profile: {name}')
    return jsonify({'success': True})


@app.route('/api/centers/<int:center_id>/recipients')
@login_required
def api_center_recipients(center_id):
    recipients = Recipient.query.filter_by(center_id=center_id).order_by(Recipient.name.asc()).all()
    return jsonify([r.to_dict() for r in recipients])


# autocomplete search apis
@app.route('/api/medicines/search')
@login_required
def api_medicines_search():
    q = request.args.get('q', '')
    if not q:
        return jsonify([])
    # Get unique article names
    meds = Medicine.query.filter(
        Medicine.status.in_(['Active', 'Near Expiry']),
        Medicine.article_name.ilike(f'%{q}%')
    ).with_entities(Medicine.article_name).distinct().limit(10).all()
    return jsonify([m[0] for m in meds])


@app.route('/api/recipients/search')
@login_required
def api_recipients_search():
    q = request.args.get('q', '')
    if not q:
        return jsonify([])
    recipients = Recipient.query.filter(
        Recipient.name.ilike(f'%{q}%')
    ).limit(15).all()
    # Include center name in the search results for better identification
    return jsonify([{
        'id': r.id,
        'name': r.name,
        'contact': r.contact,
        'center_id': r.center_id,
        'center_name': r.center.name if r.center else '',
        'full_display': f"{r.name} ({r.center.name if r.center else 'No Center'})"
    } for r in recipients])


# activity logs api
@app.route('/api/logs')
@login_required
def api_logs():
    query = ActivityLog.query

    action_filter = request.args.get('action', '')
    if action_filter:
        query = query.filter_by(action=action_filter)

    search = request.args.get('search', '')
    if search:
        query = query.filter(
            db.or_(
                ActivityLog.details.ilike(f'%{search}%'),
                ActivityLog.performed_by.ilike(f'%{search}%')
            )
        )

    recipient = request.args.get('recipient', '')
    if recipient:
        query = query.filter(ActivityLog.details.ilike(f'%{recipient}%'))

    center = request.args.get('center', '')
    if center:
        query = query.filter(ActivityLog.details.ilike(f'%{center}%'))

    medicine = request.args.get('medicine', '')
    if medicine:
        query = query.filter(ActivityLog.details.ilike(f'%{medicine}%'))

    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    
    if date_from:
        try:
            df = datetime.strptime(date_from, '%Y-%m-%d').date()
            query = query.filter(db.func.date(ActivityLog.timestamp) >= df)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.strptime(date_to, '%Y-%m-%d').date()
            query = query.filter(db.func.date(ActivityLog.timestamp) <= dt)
        except ValueError:
            pass

    logs = query.order_by(ActivityLog.timestamp.desc()).limit(500).all()
    return jsonify([l.to_dict() for l in logs])


@app.route('/api/logs/export/csv')
@login_required
def api_logs_export_csv():
    logs = ActivityLog.query.order_by(ActivityLog.timestamp.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Timestamp', 'Action', 'Performed By', 'Details'])
    for l in logs:
        writer.writerow([
            l.id,
            l.timestamp.strftime('%Y-%m-%d %H:%M') if l.timestamp else '',
            l.action,
            l.performed_by,
            l.details
        ])
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'medisync_logs_{manila_today().isoformat()}.csv'
    )


@app.route('/api/logs/export/pdf')
@login_required
def api_logs_export_pdf():
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    logs = ActivityLog.query.order_by(ActivityLog.timestamp.desc()).limit(1000).all()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph('MediSync - Activity Logs Report', styles['Title']))
    elements.append(Paragraph(f'Generated: {manila_now().strftime("%Y-%m-%d %H:%M")}', styles['Normal']))
    elements.append(Spacer(1, 0.3 * inch))

    headers = ['ID', 'Timestamp', 'Action', 'Performed By', 'Details']
    data = [headers]
    for l in logs:
        data.append([
            str(l.id),
            l.timestamp.strftime('%Y-%m-%d %H:%M') if l.timestamp else '',
            l.action,
            l.performed_by,
            l.details
        ])

    table = Table(data, colWidths=[0.5*inch, 1.5*inch, 1*inch, 1.5*inch, 5.5*inch], repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#5CB9A4')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    return send_file(
        buffer, mimetype='application/pdf', as_attachment=True,
        download_name=f'medisync_logs_{manila_today().isoformat()}.pdf'
    )


@app.route('/api/logs/archive', methods=['POST'])
@login_required
def api_logs_archive():
    six_months_ago = manila_now() - timedelta(days=180)
    old_logs = ActivityLog.query.filter(ActivityLog.timestamp <= six_months_ago).order_by(ActivityLog.timestamp.asc()).all()
    
    if not old_logs:
        return jsonify({'error': 'No logs older than 6 months found.'}), 400

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Timestamp', 'Action', 'Performed By', 'Details'])
    
    for l in old_logs:
        writer.writerow([
            l.id,
            l.timestamp.strftime('%Y-%m-%d %H:%M') if l.timestamp else '',
            l.action,
            l.performed_by,
            l.details
        ])
        db.session.delete(l)
        
    db.session.commit()
    log_activity('System', f'Archived and deleted {len(old_logs)} logs older than 6 months.')

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'medisync_archived_logs_{manila_today().isoformat()}.csv'
    )


# notifications api
@app.route('/api/notifications')
@login_required
def api_notifications():
    notifs = Notification.query.order_by(Notification.created_at.desc()).limit(50).all()
    return jsonify([n.to_dict() for n in notifs])


@app.route('/api/notifications/<int:n_id>/read', methods=['PUT'])
@login_required
def api_mark_notification_read(n_id):
    n = Notification.query.get_or_404(n_id)
    n.is_read = True
    db.session.commit()
    return jsonify(n.to_dict())


@app.route('/api/notifications/read-all', methods=['PUT'])
@login_required
def api_mark_all_read():
    Notification.query.filter_by(is_read=False).update({'is_read': True})
    db.session.commit()
    return jsonify({'success': True})


# account/settings api
@app.route('/api/settings/profile', methods=['PUT'])
@login_required
def api_update_profile():
    user = User.query.get(getattr(request, 'current_user_id', session.get('user_id')))
    data = request.get_json()
    if data.get('full_name'):
        user.full_name = data['full_name']
    if data.get('username'):
        existing = User.query.filter(User.username == data['username'], User.id != user.id).first()
        if existing:
            return jsonify({'error': 'Username already taken.'}), 400
        user.username = data['username']
    if data.get('password'):
        user.set_password(data['password'])
    db.session.commit()
    log_activity('Edit', f'Updated profile for {user.username}')
    return jsonify(user.to_dict())


@app.route('/api/settings/picture', methods=['POST'])
@login_required
def api_upload_picture():
    if 'picture' not in request.files:
        return jsonify({'error': 'No file uploaded.'}), 400
    file = request.files['picture']
    if file.filename == '':
        return jsonify({'error': 'Empty filename.'}), 400
    _uid = getattr(request, 'current_user_id', session.get('user_id'))
    user = User.query.get(_uid)

    # Read file and store as base64 data URL — works on Vercel (no persistent filesystem)
    import base64
    file_bytes = file.read()
    if len(file_bytes) > 2 * 1024 * 1024:  # 2MB limit
        return jsonify({'error': 'Image too large. Max 2MB.'}), 400
    mime = file.content_type or 'image/jpeg'
    b64 = base64.b64encode(file_bytes).decode('utf-8')
    data_url = f'data:{mime};base64,{b64}'

    user.profile_picture = data_url
    db.session.commit()
    log_activity('Edit', 'Updated profile picture')
    return jsonify(user.to_dict())


# --- Sub-Accounts API ---
@app.route('/api/accounts/sub', methods=['GET'])
@login_required
def api_list_sub_accounts():
    """List sub-accounts created by the current admin."""
    uid = getattr(request, 'current_user_id', session.get('user_id'))
    current_user = User.query.get(uid)
    # Admins see their own subs; sub-accounts see their parent's subs
    parent_id = uid if (current_user.role == 'admin' or not current_user.parent_id) else current_user.parent_id
    subs = User.query.filter_by(parent_id=parent_id).order_by(User.created_at.desc()).all()
    return jsonify([s.to_dict() for s in subs])


@app.route('/api/accounts/sub', methods=['POST'])
@login_required
def api_create_sub_account():
    """Create a sub-account (max 5 per admin)."""
    uid = getattr(request, 'current_user_id', session.get('user_id'))
    current_user = User.query.get(uid)
    # Only admins (non-sub) can create sub-accounts
    if current_user.role == 'sub':
        return jsonify({'error': 'Sub-accounts cannot create other accounts.'}), 403
    # Check limit
    existing_subs = User.query.filter_by(parent_id=uid).count()
    if existing_subs >= 5:
        return jsonify({'error': 'Maximum of 5 sub-accounts reached.'}), 400
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    full_name = data.get('full_name', '').strip()
    if not username or not password or not full_name:
        return jsonify({'error': 'Username, password, and full name are required.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken.'}), 400
    sub = User(username=username, full_name=full_name, role='sub', parent_id=uid)
    sub.set_password(password)
    db.session.add(sub)
    db.session.commit()
    log_activity('Add', f'Created sub-account: {full_name} ({username})')
    return jsonify(sub.to_dict()), 201


@app.route('/api/accounts/sub/<int:sub_id>', methods=['DELETE'])
@login_required
def api_delete_sub_account(sub_id):
    """Delete a sub-account."""
    uid = getattr(request, 'current_user_id', session.get('user_id'))
    sub = User.query.get_or_404(sub_id)
    if sub.parent_id != uid:
        return jsonify({'error': 'Not authorized to delete this account.'}), 403
    username = sub.username
    # Delete auth tokens for this sub
    AuthToken.query.filter_by(user_id=sub_id).delete()
    db.session.delete(sub)
    db.session.commit()
    log_activity('Delete', f'Deleted sub-account: {username}')
    return jsonify({'success': True})


@app.route('/api/accounts/sub/<int:sub_id>/activity')
@login_required
def api_sub_account_activity(sub_id):
    """Get activity logs for a specific sub-account."""
    uid = getattr(request, 'current_user_id', session.get('user_id'))
    sub = User.query.get_or_404(sub_id)
    if sub.parent_id != uid:
        return jsonify({'error': 'Not authorized.'}), 403
    # Search logs by the sub's full name
    logs = ActivityLog.query.filter(
        ActivityLog.performed_by.ilike(f'%{sub.full_name}%')
    ).order_by(ActivityLog.timestamp.desc()).limit(100).all()
    return jsonify([l.to_dict() for l in logs])


@app.route('/api/accounts/sub/<int:sub_id>/reset-password', methods=['PUT'])
@login_required
def api_reset_sub_password(sub_id):
    """Reset a sub-account's password."""
    uid = getattr(request, 'current_user_id', session.get('user_id'))
    sub = User.query.get_or_404(sub_id)
    if sub.parent_id != uid:
        return jsonify({'error': 'Not authorized.'}), 403
    data = request.get_json()
    new_pw = data.get('password', '').strip()
    if not new_pw or len(new_pw) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    sub.set_password(new_pw)
    db.session.commit()
    log_activity('Edit', f'Reset password for sub-account: {sub.username}')
    return jsonify({'success': True})


# database initialization
def create_tables():
    db.create_all()
    if not User.query.first():
        admin = User(username='admin', full_name='System Administrator', role='admin')
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        print('  Default admin created (admin / admin123)')


if __name__ == '__main__':
    with app.app_context():
        create_tables()
    app.run(debug=True, port=10000)