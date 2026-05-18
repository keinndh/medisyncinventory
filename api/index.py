import sys
import os

# Add root directory to path so app.py can import models, static, templates
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

# Vercel Python runtime expects 'app' at module level (WSGI callable)
# Do NOT rename to 'handler' — that breaks Vercel's Python runtime
