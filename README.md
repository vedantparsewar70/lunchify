# SchoolBite — School Canteen Meal Ordering & Management System

> A modern, responsive, full-stack web application designed for Indian schools to streamline canteen operations, enable advance healthy meal scheduling for parents, and simplify lunch prep for kitchen staff.

---

## 🌟 Key Features

### 👨‍👩‍👧‍👦 Parent Portal
- **Account & Profile**: Secure registration with ₹500 welcome meal wallet credit, profile management, and contact updates.
- **Multi-Child Management**: Register multiple children with Class, Division, Roll Number, Student ID, Allergies/Dietary alerts, and Pure Veg / Non-Veg classification.
- **Daily & Weekly Menus**: Visual menu browser featuring Indian school lunches with high-res photos, ingredients, calorie counts, prices in ₹, available stock, and cutoff deadlines.
- **Child-Specific Meal Selection**: Select different meals for different siblings (e.g., Aarav gets *Paneer Rice Bowl* while Anaya gets *Creamy Veg Pasta*) across different dates in a single checkout.
- **Multi-Child Cart**: Shopping cart grouped cleanly by child and scheduled date with quantity controls and special chef preparation notes.
- **Simulated Payment Gateway**: Tailored for Indian schools with UPI (GPay, PhonePe, Paytm, custom VPA), RuPay/Cards, Net Banking (SBI, HDFC, ICICI, Axis), and instant 1-click School Meal Wallet.
- **Order Tracking & Vouchers**: Real-time status tracking (*Confirmed → Preparing → Ready → Collected*). Printable official canteen tokens/vouchers with QR code mock.
- **Cancellation & Instant Refund**: Cancel meals prior to the 08:30 AM cutoff deadline with automatic stock restoration and wallet refund.
- **Payment History**: Detailed transaction log with transaction IDs, order references, payment modes, and date/status filters.

---

### 🏫 School & Canteen Admin Portal
- **Operations Dashboard**: Real-time KPI tiles for *Today's Orders*, *Revenue (₹)*, *Pending Orders*, *Meals Sold*, and *Students Served*.
- **Live Status Controller**: Quickly advance orders through fulfillment stages (*Confirmed → Preparing → Ready → Collected*).
- **Master Meal Catalog**: Create, edit, and categorize recipes with allergens, ingredients, calories, and prices.
- **Date Scheduling & Quotas**: Publish daily menus for specific dates, configure preparation quotas (e.g. 50 portions), and set order cutoff deadlines (e.g. 08:30 AM).
- **Dedicated Kitchen Display System (KDS)**:
  - Simplified, high-contrast, tablet/desktop optimized view.
  - Aggregated meal prep targets (e.g., *Paneer Rice Bowl — 75*, *Veg Thali — 62*, *Total: 216*).
  - Classroom & Division breakdown for distribution.
  - Student checklist highlighting allergy alerts.
  - One-click bulk status updating (*Mark All in Prep*, *Mark All Ready*, *Mark All Collected*).
  - Print Kitchen Preparation Sheet & One-Click CSV Export.
- **Sales & Operations Reports**:
  - Daily, weekly, and monthly sales aggregations.
  - Most ordered meals ranking with visual progress bars.
  - Order volume breakdown by Class and Division.
  - Comprehensive CSV audit export.
- **Accounts Directory**: Overview of enrolled parents, student profiles, and prepaid wallet balances.

---

## 🔑 Demo Credentials

| Role | Email | Password | Details |
| :--- | :--- | :--- | :--- |
| **Parent** | `parent@example.com` | `Parent123` | Pre-registered with 2 children (*Aarav Sharma* & *Anaya Sharma*), ₹500 wallet balance, and active orders. |
| **Canteen Admin** | `admin@school.com` | `Admin123` | Full administrative control, kitchen view, menu management, and sales reports. |

> *Quick-fill buttons are integrated directly into the login screen for instant one-click testing.*

---

## 🛠 Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Lucide React Icons, Canvas-Confetti
- **Backend**: Next.js API Routes & Server Actions
- **Database**: Google Firebase Cloud Firestore (via `firebase-admin` SDK)
- **Authentication**: JWT session tokens via `jose` with HTTP-Only secure cookies and `bcryptjs` password hashing
- **Currency & Localization**: Indian Rupee (₹ INR), Indian FSSAI Veg/Non-Veg badges, date formatting for Indian school terms

---

## 🚀 Running Locally with Firebase Firestore

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Firebase**:
   Download your Firebase Service Account Private Key from **Firebase Console** -> **Project Settings** -> **Service accounts** and copy its values into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` in `.env` (or set `FIREBASE_SERVICE_ACCOUNT_KEY` to the full JSON). Credentials are read only from environment variables; never commit the JSON file.

3. **Seed demo Indian school meals and sample orders into Firestore**:
   ```bash
   npm run db:seed-firestore
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` (or `http://localhost:3001` if port 3000 is occupied).

5. **Run End-to-End Automated Integration Test**:
   ```bash
   npx tsx test-e2e.ts
   ```
