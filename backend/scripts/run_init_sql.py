import os
import sys
import pymysql

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.core.config import settings


def main():
    script_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sql", "init_mysql.sql")
    with open(script_path, "r", encoding="utf-8") as sql_file:
        sql_script = sql_file.read()

    statements = [statement.strip() for statement in sql_script.split(";") if statement.strip()]

    connection = pymysql.connect(
        host=settings.HOST,
        port=int(settings.PORT),
        user=settings.USER,
        password=settings.PASSWORD,
        charset="utf8mb4",
        autocommit=True,
    )
    try:
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)
        print(f"Executed {len(statements)} SQL statements from {script_path}")
        print(f"MySQL host: {settings.HOST}:{settings.PORT}")
        print(f"Target database: {settings.DB_NAME}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
