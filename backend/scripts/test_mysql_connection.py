import os
import sys

from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.core.config import settings
from app.db.session import engine


def main():
    with engine.connect() as connection:
        current_database = connection.execute(text("SELECT DATABASE()")).scalar()
        current_user = connection.execute(text("SELECT CURRENT_USER()")).scalar()
        print(f"Connected to: {engine.url.render_as_string(hide_password=False)}")
        print(f"Current database: {current_database}")
        print(f"MySQL user: {current_user}")


if __name__ == "__main__":
    main()
