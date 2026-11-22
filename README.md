# InternTrack

### OJT Weekly Report and DTR Monitoring System

InternTrack is a multi-user On-the-Job Training (OJT) Management and Monitoring System designed to centralize attendance recording, Daily Time Record (DTR) management, weekly accomplishment reports, attendance verification, and internship progress monitoring.

The system consists of a mobile application for Student Interns and a web application for Company Supervisors and OJT Coordinators.

---

## System Overview

InternTrack aims to make OJT monitoring more organized and accessible by connecting students, supervisors, and coordinators through a shared backend and database.

## System Users

| User Role | Platform | Responsibilities |
|---|---|---|
| Student Intern | Mobile Application | Record attendance, view DTR, submit weekly reports, and monitor OJT progress |
| Company Supervisor | Web Application | Verify attendance, review weekly reports, and monitor assigned interns |
| OJT Coordinator | Web Application | Manage accounts, assign interns to supervisors, and monitor overall OJT activities |

## Key Features

### Student Intern
- Attendance recording with photos and location coordinates
- Offline attendance recording and synchronization
- Digital Daily Time Record (DTR)
- Weekly accomplishment report submission
- OJT hours and progress monitoring

### Company Supervisor
- Supervisor dashboard
- Attendance verification
- Weekly accomplishment report review
- Assigned intern roster
- Intern progress monitoring

### OJT Coordinator
- Administrative dashboard
- Student intern management
- Company supervisor management
- User account management
- Intern-supervisor assignment
- Overall OJT monitoring

## Offline Attendance Support

InternTrack is designed to support attendance recording without an active internet connection.

Attendance records are temporarily stored on the student's device and synchronized with the server when connectivity becomes available.

Supervisors can review attendance records after successful synchronization.

## Attendance Verification

Student Interns can record their Time-In and Time-Out details, including photos and location coordinates.

Company Supervisors can review these records and verify attendance.

Only verified attendance hours count toward official OJT completion progress.

## System Architecture

The system uses three connected components:

1. Student Intern Mobile Application
2. Company Supervisor and OJT Coordinator Web Application
3. Shared Backend and Database

Role-based access control ensures that users can only access information and features authorized for their roles.

## Project Scope

InternTrack focuses on:
- User account management
- Intern-supervisor assignments
- Attendance recording and synchronization
- DTR management
- Attendance verification
- Weekly accomplishment report submission and review
- OJT progress monitoring

## Technology Stack

| Technology | Purpose |
|---|---|
| Angular | Application framework |
| Ionic Framework | Mobile application UI |
| TypeScript | Application development |
| Capacitor | Native Android integration |
| Supabase | Backend services integration |
| PDF.js | PDF document processing |
| pdfmake | PDF document generation |

## Getting Started

### Prerequisites

Before running InternTrack, install:

- Node.js and npm compatible with Angular 22
- Git
- Android Studio (for Android development)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/str0beri/InternTrack.git
```

2. Navigate to the project directory:

```bash
cd InternTrack
```

3. Install dependencies:

```bash
npm ci
```

4. Configure the required Supabase connection using
   your authorized project credentials.

5. Start the development server:

```bash
npm start
```

### Available Commands

| Command | Description |
|---|---|
| `npm start` | Start the Angular development server |
| `npm run build` | Build the application |
| `npm run test:unit` | Run unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run eslint` | Check code using ESLint |

### Android Development

The project includes Capacitor Android dependencies.

After configuring the Android development environment,
the application can be synchronized with the Android project:

```bash
npx cap sync android
```

Android Studio is required to build and run the native Android application.

## Development Notes

- The project is currently under development.
- Backend access requires valid Supabase configuration.
- Never commit API secrets or private credentials.
- Some features may require additional configuration.

## Project Status

Under Development

---

InternTrack | OJT Management and Monitoring System
