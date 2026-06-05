from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List
from app.db.session import get_db
from app.models.device import Device
from app.schemas.device import DeviceRegister, DeviceHeartbeat, DeviceResponse
from app.services.jwt_helper import create_device_token
from app.api.websocket_gateway import gateway

router = APIRouter()

@router.post("/device/register")
def register_device(payload: DeviceRegister, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    token = create_device_token(payload.device_id)
    
    if device:
        device.hostname = payload.hostname
        device.username = payload.username
        device.os = payload.os
        device.agent_version = payload.agent_version
        device.device_token = token
        device.status = "online"
        device.last_seen = datetime.utcnow()
    else:
        device = Device(
            device_id=payload.device_id,
            hostname=payload.hostname,
            username=payload.username,
            os=payload.os,
            agent_version=payload.agent_version,
            device_token=token,
            status="online",
            last_seen=datetime.utcnow()
        )
        db.add(device)
    
    db.commit()
    db.refresh(device)
    
    # Update cache
    gateway.device_live_cache[device.device_id] = {
        "device_id": device.device_id,
        "status": "online",
        "hostname": device.hostname,
        "username": device.username,
        "os": device.os,
        "agent_version": device.agent_version,
        "current_frame": gateway.device_live_cache.get(device.device_id, {}).get("current_frame", device.current_frame),
        "recognized_person": gateway.device_live_cache.get(device.device_id, {}).get("recognized_person", device.recognized_person),
        "last_seen": device.last_seen
    }
    
    # Broadcast status change to connected websocket clients
    gateway.broadcast_sync("device_update", {
        "device_id": device.device_id,
        "status": "online"
    })
    
    return {"device_token": token}

@router.post("/device/heartbeat")
def device_heartbeat(payload: DeviceHeartbeat, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    was_offline = device.status == "offline"
    device.status = "online"
    device.last_seen = datetime.utcnow()
    db.commit()
    
    # Update cache
    if device.device_id in gateway.device_live_cache:
        gateway.device_live_cache[device.device_id]["status"] = "online"
        gateway.device_live_cache[device.device_id]["last_seen"] = device.last_seen
    else:
        gateway.device_live_cache[device.device_id] = {
            "device_id": device.device_id,
            "status": "online",
            "hostname": device.hostname,
            "username": device.username,
            "os": device.os,
            "agent_version": device.agent_version,
            "current_frame": device.current_frame,
            "recognized_person": device.recognized_person,
            "last_seen": device.last_seen
        }
    
    if was_offline:
        gateway.broadcast_sync("device_update", {
            "device_id": device.device_id,
            "status": "online"
        })
        
    return {"status": "ok"}

@router.get("/device/status", response_model=List[DeviceResponse])
def get_device_status(db: Session = Depends(get_db)):
    devices = db.query(Device).all()
    for d in devices:
        if d.device_id in gateway.device_live_cache:
            live = gateway.device_live_cache[d.device_id]
            d.status = live.get("status", d.status)
            d.last_seen = live.get("last_seen", d.last_seen)
            d.current_frame = live.get("current_frame", d.current_frame)
            d.recognized_person = live.get("recognized_person", d.recognized_person)
    return devices

@router.get("/agent/version")
def get_agent_version():
    return {
        "latest_version": "1.0.0",
        "download_url": ""
    }
