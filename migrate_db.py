import sqlite3
import os

# Database path
DB_PATH = 'medicine_inventory.db'

def migrate():
    if not os.path.exists(DB_PATH):
        print(f"Database {DB_PATH} not found. Running app.py will create it.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("Checking for recipients table...")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recipients'")
    if not cursor.fetchone():
        print("Creating recipients table...")
        cursor.execute('''
            CREATE TABLE recipients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(200) NOT NULL,
                contact VARCHAR(100),
                center_id INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(center_id) REFERENCES centers(id)
            )
        ''')
        print("Table 'recipients' created.")
    else:
        print("Table 'recipients' already exists.")

    print("Checking for is_restock and is_new_batch in medicines table...")
    cursor.execute("PRAGMA table_info(medicines)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'is_restock' not in columns:
        print("Adding 'is_restock' column to medicines...")
        cursor.execute("ALTER TABLE medicines ADD COLUMN is_restock BOOLEAN DEFAULT 0")
    
    if 'is_new_batch' not in columns:
        print("Adding 'is_new_batch' column to medicines...")
        cursor.execute("ALTER TABLE medicines ADD COLUMN is_new_batch BOOLEAN DEFAULT 1")

    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == '__main__':
    migrate()
