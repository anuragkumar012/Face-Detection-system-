from sqlalchemy.orm import declarative_base

Base = declarative_base()

# Import all models to ensure they are registered on the Base metadata
from app.models.account import Account
from app.models.user import User
from app.models.face_embedding import FaceEmbedding
from app.models.unknown_detection import UnknownDetection
from app.models.presence_log import PresenceLog
from app.models.presence_session import PresenceSession
from app.models.device import Device
from app.models.photo_scan import PhotoScan
from app.models.face_cluster import FaceCluster
from app.models.dashboard_session_history import DashboardSessionHistory

