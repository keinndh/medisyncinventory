from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta, timezone

MANILA_TZ = timezone(timedelta(hours=8))

def manila_now():
    return datetime.now(MANILA_TZ).replace(tzinfo=None)

def manila_today():
    return manila_now().date()
db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    full_name = db.Column(db.String(120), nullable=False, default='Admin')
    profile_picture = db.Column(db.Text, default='')
    role = db.Column(db.String(20), default='admin')  # admin or sub
    parent_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: manila_now())

    # Relationships
    parent = db.relationship('User', remote_side=[id], backref=db.backref('sub_accounts', lazy=True))

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'full_name': self.full_name,
            'profile_picture': self.profile_picture,
            'role': self.role or 'admin',
            'parent_id': self.parent_id,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Medicine(db.Model):
    __tablename__ = 'medicines'
    id = db.Column(db.Integer, primary_key=True)
    stock_number = db.Column(db.String(50), unique=True, nullable=False)
    article_name = db.Column(db.String(200), nullable=False)
    description_dosage = db.Column(db.String(300), default='')
    unit_of_measurement = db.Column(db.String(50), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=0)
    category = db.Column(db.String(500), default='')
    category_type = db.Column(db.String(200), default='')  # Optional category (hidden from table, used for filtering)
    remarks = db.Column(db.Text, default='')
    expiration_date = db.Column(db.Date, nullable=True)
    date_added = db.Column(db.DateTime, default=lambda: manila_now())
    status = db.Column(db.String(30), default='Active')  # Active, Expired, Discarded, Deleted
    is_new_batch = db.Column(db.Boolean, default=True)
    is_restock = db.Column(db.Boolean, default=False)
    discard_reason = db.Column(db.Text, default='')
    delete_reason = db.Column(db.Text, default='')

    dispensings = db.relationship('Dispensing', backref='medicine', lazy=True)
    queue_items = db.relationship('RequestQueue', backref='medicine', lazy=True)

    def to_dict(self):
        days_remaining = None
        if self.expiration_date:
            delta = self.expiration_date - manila_today()
            days_remaining = delta.days

        return {
            'id': self.id,
            'stock_number': self.stock_number,
            'article_name': self.article_name,
            'description_dosage': self.description_dosage,
            'unit_of_measurement': self.unit_of_measurement,
            'quantity': self.quantity,
            'category': self.category,
            'category_type': self.category_type or '',
            'remarks': self.remarks,
            'expiration_date': self.expiration_date.isoformat() if self.expiration_date else None,
            'date_added': self.date_added.isoformat() if self.date_added else None,
            'status': self.status,
            'is_new_batch': self.is_new_batch,
            'is_restock': self.is_restock,
            'discard_reason': self.discard_reason,
            'delete_reason': self.delete_reason,
            'days_remaining': days_remaining
        }


class Center(db.Model):
    __tablename__ = 'centers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: manila_now())

    dispensings = db.relationship('Dispensing', backref='center', lazy=True)
    queue_items = db.relationship('RequestQueue', backref='center', lazy=True)
    recipients = db.relationship('Recipient', backref='center', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Recipient(db.Model):
    __tablename__ = 'recipients'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    contact = db.Column(db.String(100), default='')
    center_id = db.Column(db.Integer, db.ForeignKey('centers.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: manila_now())

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'contact': self.contact,
            'center_id': self.center_id,
            'center_name': self.center.name if self.center else '',
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Dispensing(db.Model):
    __tablename__ = 'dispensings'
    id = db.Column(db.Integer, primary_key=True)
    dispenser_name = db.Column(db.String(200), nullable=False)
    medicine_id = db.Column(db.Integer, db.ForeignKey('medicines.id'), nullable=False)
    recipient_name = db.Column(db.String(200), nullable=False)
    recipient_contact = db.Column(db.String(100), default='')
    center_id = db.Column(db.Integer, db.ForeignKey('centers.id'), nullable=True)
    quantity_dispensed = db.Column(db.Integer, nullable=False)
    date_time = db.Column(db.DateTime, default=lambda: manila_now())
    remarks = db.Column(db.Text, default='')
    serial_number = db.Column(db.String(20), unique=True, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'dispenser_name': self.dispenser_name,
            'medicine_id': self.medicine_id,
            'medicine_name': self.medicine.article_name if self.medicine else '',
            'medicine_stock': self.medicine.stock_number if self.medicine else '',
            'recipient_name': self.recipient_name,
            'recipient_contact': self.recipient_contact,
            'center_id': self.center_id,
            'center_name': self.center.name if self.center else '',
            'quantity_dispensed': self.quantity_dispensed,
            'date_time': self.date_time.isoformat() if self.date_time else None,
            'remarks': self.remarks,
            'serial_number': self.serial_number
        }


class RequestQueue(db.Model):
    __tablename__ = 'request_queue'
    id = db.Column(db.Integer, primary_key=True)
    dispenser_name = db.Column(db.String(200), nullable=False)
    medicine_id = db.Column(db.Integer, db.ForeignKey('medicines.id'), nullable=False)
    recipient_name = db.Column(db.String(200), nullable=False)
    recipient_contact = db.Column(db.String(100), default='')
    center_id = db.Column(db.Integer, db.ForeignKey('centers.id'), nullable=True)
    quantity_requested = db.Column(db.Integer, nullable=False)
    priority = db.Column(db.Integer, default=0)
    status = db.Column(db.String(30), default='Pending')  # Pending, Fulfilled
    created_at = db.Column(db.DateTime, default=lambda: manila_now())
    fulfilled_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'dispenser_name': self.dispenser_name,
            'medicine_id': self.medicine_id,
            'medicine_name': self.medicine.article_name if self.medicine else '',
            'medicine_stock': self.medicine.stock_number if self.medicine else '',
            'recipient_name': self.recipient_name,
            'recipient_contact': self.recipient_contact,
            'center_id': self.center_id,
            'center_name': self.center.name if self.center else '',
            'quantity_requested': self.quantity_requested,
            'priority': self.priority,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'fulfilled_at': self.fulfilled_at.isoformat() if self.fulfilled_at else None
        }


class ActivityLog(db.Model):
    __tablename__ = 'activity_logs'
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=lambda: manila_now())
    action = db.Column(db.String(50), nullable=False)  # Login, Add, Edit, Delete, Discard, Dispense, Restock, Logout
    performed_by = db.Column(db.String(120), nullable=False)
    details = db.Column(db.Text, default='')

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'action': self.action,
            'performed_by': self.performed_by,
            'details': self.details
        }


class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.String(500), nullable=False)
    type = db.Column(db.String(50), default='info')  # info, warning, alert
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: manila_now())
    reference_id = db.Column(db.Integer, nullable=True)
    reference_type = db.Column(db.String(50), default='')

    def to_dict(self):
        return {
            'id': self.id,
            'message': self.message,
            'type': self.type,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'reference_id': self.reference_id,
            'reference_type': self.reference_type
        }


class MedicineCategory(db.Model):
    __tablename__ = 'medicine_categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(500), unique=True, nullable=False)

    def to_dict(self):
        return {'id': self.id, 'name': self.name}

class AuthToken(db.Model):
    """Persistent auth tokens — safe for serverless (Vercel) deployments."""
    __tablename__ = 'auth_tokens'
    id       = db.Column(db.Integer, primary_key=True)
    token    = db.Column(db.String(64), unique=True, nullable=False, index=True)
    user_id  = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: manila_now())

    user = db.relationship('User', backref='auth_tokens')
