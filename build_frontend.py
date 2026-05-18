import os
import shutil

# Set dummy DATABASE_URL so app.py doesn't crash during import on Netlify
os.environ['DATABASE_URL'] = 'sqlite:///dummy.db'

from app import app
from flask import session

def build_static_frontend():
    # Define the pages to freeze
    pages = [
        '/', '/login', '/dashboard', '/inventory', '/dispensing',
        '/analytics', '/centers', '/logs', '/settings'
    ]

    # Clean and setup the dist directory
    dist_dir = 'dist'
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir, exist_ok=True)

    # Copy all static assets exactly as-is
    print("Copying static assets...")
    shutil.copytree('static', os.path.join(dist_dir, 'static'))

    # Start Flask test client to render all pages
    print("Rendering templates to static HTML...")
    with app.test_client() as client:
        with app.app_context():
            from models import db
            db.create_all()

        print("Rendering /login (unauthenticated)...")
        response = client.get('/login')
        html = response.data.decode('utf-8')
        with open(os.path.join(dist_dir, 'login.html'), 'w', encoding='utf-8') as f:
            f.write(html)
        with open(os.path.join(dist_dir, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(html)

        # Render authenticated pages
        auth_pages = [
            '/dashboard', '/inventory', '/dispensing',
            '/analytics', '/centers', '/logs', '/settings'
        ]

        # Mock session to bypass @login_required decorators
        with client.session_transaction() as sess:
            sess['user_id'] = 1  # Fake user_id for rendering

        for page in auth_pages:
            print(f"Rendering {page}...")
            response = client.get(page)
            if response.status_code == 200:
                html = response.data.decode('utf-8')
                filename = f"{page.strip('/')}.html"
                filepath = os.path.join(dist_dir, filename)
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(html)
            else:
                print(f"Warning: Failed to render {page} - Status code {response.status_code}")

    print("Frontend build complete! Output is in the 'dist' directory.")

if __name__ == '__main__':
    build_static_frontend()
