import hashlib
import hmac
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.account import Account


def hash_password(password: str) -> str:
    secret = settings.AUTH_SECRET_KEY.encode("utf-8")
    return hashlib.sha256(secret + password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    expected_hash = hash_password(password)
    return hmac.compare_digest(expected_hash, password_hash)


def get_account_by_credentials(db: Session, username: str, role: str) -> Account | None:
    return (
        db.query(Account)
        .filter(Account.username == username.strip(), Account.role == role.strip().lower())
        .first()
    )


def seed_default_accounts(db: Session) -> None:
    default_accounts = [
        {
            "username": settings.DEFAULT_ADMIN_USERNAME,
            "password": settings.DEFAULT_ADMIN_PASSWORD,
            "role": "admin",
        },
        {
            "username": settings.DEFAULT_USER_USERNAME,
            "password": settings.DEFAULT_USER_PASSWORD,
            "role": "user",
        },
    ]

    created_any = False
    for account_data in default_accounts:
        existing_account = get_account_by_credentials(
            db,
            username=account_data["username"],
            role=account_data["role"],
        )
        if existing_account:
            continue

        db.add(
            Account(
                username=account_data["username"],
                password_hash=hash_password(account_data["password"]),
                role=account_data["role"],
            )
        )
        created_any = True

    if created_any:
        db.commit()
