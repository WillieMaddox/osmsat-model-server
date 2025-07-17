# OSMSAT Model Server

A Node.js/Express API server for sharing TensorFlow.js models between OSMSAT users with advanced drag-and-drop functionality and comprehensive model management features.

## Features

### Core Functionality
- **User Authentication**: JWT-based authentication with bcrypt password hashing
- **Model Management**: Complete CRUD operations for TensorFlow.js models
- **File Upload/Download**: Robust file handling with multer middleware
- **Public/Private Sharing**: Model visibility controls with owner permissions
- **Multi-format Support**: Handles detect/obb/pose model types with validation
- **PostgreSQL Database**: Comprehensive schema with users, models, and model_versions tables
- **Docker Containerization**: Full Docker Compose setup for easy deployment

### Advanced Upload Features
- **Drag & Drop Interface**: Support for both file and folder drag-and-drop
- **Directory Traversal**: Automatically processes nested folder structures using webkitGetAsEntry API
- **File Validation**: Real-time validation ensuring required files (.yaml, .json, .bin) are present
- **Auto-Population**: Automatically extracts metadata from YAML files to populate form fields
- **Smart Naming**: Auto-populates model names from folder names during drag-and-drop
- **Form State Management**: Real-time button state updates and comprehensive form validation
- **Progress Indicators**: Visual feedback during upload process with file count display

### User Interface
- **Responsive Design**: Clean, modern interface with drag-and-drop visual feedback
- **Real-time Validation**: Instant feedback on file selection and form completion
- **Model Cards**: Rich display of model information including version, creation date, and file size
- **Visibility Controls**: Easy toggle between public/private model sharing
- **Download Management**: Efficient multi-file download with automatic file detection
- **Authentication Flow**: Seamless login/register with persistent session management

### Technical Features
- **Security**: Content Security Policy configuration, input validation, and secure file handling
- **Performance**: Compression middleware, efficient database queries, and optimized file operations
- **Scalability**: Structured database schema with proper indexing and foreign key relationships
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Versioning**: Model version management with active version tracking
- **Metadata Management**: JSONB storage for flexible model metadata including form-provided dates

## Quick Start

1. **Using Docker Compose (Recommended)**
   ```bash
   docker-compose up -d
   ```

2. **Manual Setup**
   ```bash
   npm install
   cp .env.example .env
   # Edit .env with your database credentials
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Models
- `GET /api/models` - List all public models (and user's private models if authenticated)
- `GET /api/models/:id` - Get model details
- `POST /api/models` - Create new model (authenticated)
- `POST /api/models/:id/upload` - Upload model files with version and metadata (authenticated)
- `GET /api/models/:id/download/:filename` - Download specific model file
- `PATCH /api/models/:id/visibility` - Toggle model public/private visibility (authenticated)

### Users
- `GET /api/users/me` - Get current user info (authenticated)
- `GET /api/users/me/models` - Get user's models (authenticated)

## Model Structure

Models should follow the TensorFlow.js format with required files:
- `model.json` - Model architecture and weights manifest
- `group1-shard*.bin` - Weight files (variable number of shards)
- `metadata.yaml` - Model metadata including task type, description, version, and creation date

### Supported Model Types
- **detect**: Object detection models
- **obb**: Oriented bounding box detection models  
- **pose**: Pose estimation models

### Metadata Format
The `metadata.yaml` file should contain:
```yaml
task: detect
description: "YOLO-based airplane detection model"
version: "1.0.0"
date: "2025-01-15"
```

### Zoom Level Support
Models can be configured for specific zoom levels (8-21) to optimize performance at different map scales.

## Environment Variables

- `PORT` - Server port (default: 3001)
- `JWT_SECRET` - JWT signing secret
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password
- `DISABLE_REGISTRATION` - Set to `true` to disable new user registration (default: false)

## Web Interface

Visit `http://localhost:3001` to access the comprehensive web interface featuring:

### Authentication
- User registration with email validation
- Secure login with JWT token persistence
- Automatic session management and logout functionality

### Model Management
- **Browse Models**: View all public models and your private models
- **Upload Models**: Advanced drag-and-drop interface with folder support
- **Download Models**: One-click download of all model files
- **Visibility Control**: Toggle between public and private model sharing

### Upload Experience
- **Drag & Drop**: Drop entire model folders directly onto the interface
- **File Validation**: Real-time validation ensuring all required files are present
- **Auto-Population**: Automatically fills form fields from YAML metadata
- **Smart Naming**: Extracts model names from folder names
- **Progress Feedback**: Visual indicators during upload process
- **Form Management**: Comprehensive validation and state management

### Model Display
- **Rich Cards**: Detailed model information including version, size, and creation date
- **Task Type Badges**: Visual indicators for detect/obb/pose model types
- **Ownership Indicators**: Clear distinction between public/private models
- **Download Integration**: Seamless file download with automatic detection

## Database Schema

### Users Table
- `id` - Primary key
- `username` - Unique username
- `email` - User email address
- `password_hash` - Bcrypt hashed password
- `created_at`, `updated_at` - Timestamps

### Models Table
- `id` - Primary key
- `name` - Model name
- `description` - Model description
- `task_type` - Model type (detect/obb/pose)
- `zoom_level` - Optimized zoom level (8-21)
- `user_id` - Foreign key to users
- `is_public` - Public/private visibility
- `created_at`, `updated_at` - Timestamps

### Model Versions Table
- `id` - Primary key
- `model_id` - Foreign key to models
- `version` - Version string
- `file_path` - Storage path
- `file_size` - Total file size
- `metadata` - JSONB metadata storage
- `is_active` - Active version flag
- `created_at` - Creation timestamp