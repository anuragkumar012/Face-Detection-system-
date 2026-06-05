CREATE DATABASE IF NOT EXISTS `face Agent`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `face Agent`;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX ix_users_id (id),
  INDEX ix_users_name (name)
);

CREATE TABLE IF NOT EXISTS face_embeddings (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  embedding LONGBLOB NOT NULL,
  image_path VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX ix_face_embeddings_id (id),
  INDEX ix_face_embeddings_user_id (user_id),
  CONSTRAINT fk_face_embeddings_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
  id INT NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(100) NOT NULL,
  hostname VARCHAR(100) NOT NULL,
  username VARCHAR(100) NOT NULL,
  os VARCHAR(100) NOT NULL,
  agent_version VARCHAR(50) NOT NULL,
  device_token VARCHAR(500) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_frame LONGTEXT NULL,
  recognized_person VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id),
  INDEX ix_devices_id (id),
  INDEX ix_devices_device_id (device_id)
);

CREATE TABLE IF NOT EXISTS photo_scans (
  id INT NOT NULL AUTO_INCREMENT,
  source VARCHAR(30) NOT NULL DEFAULT 'frontend',
  device_id VARCHAR(100) NULL,
  original_filename VARCHAR(255) NULL,
  image_path VARCHAR(512) NOT NULL,
  face_count INT NOT NULL DEFAULT 0,
  scan_details JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX ix_photo_scans_id (id),
  INDEX ix_photo_scans_device_id (device_id),
  CONSTRAINT fk_photo_scans_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON DELETE SET NULL
);
