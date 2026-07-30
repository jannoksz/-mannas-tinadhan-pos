# 🛒 Manna's Tinadhan POS

A lightweight, tablet-friendly Point of Sale system for small businesses. Built with vanilla HTML/CSS/JS on the frontend and Node.js + Excel as the database backend.

---

## ✨ Features

### Cashier
- Browse products by category
- Search products instantly
- Add to cart with quantity control
- Checkout with cash payment and change calculation
- Official receipt display and print

### Admin
- Add new products or restock existing ones (auto-fill or manual mode)
- Delete products
- Manual stock adjustment with reason logging
- Set minimum stock per product

### Analytics
- **Sales** — View transactions by date
- **Inventory Dashboard** — Total items, stock value, low stock alerts
- **Best Sellers** — Ranked by units sold with revenue totals
- **Restock History** — Every restock event logged with before/after stock
- **Price Change Log** — Automatic log whenever a price is updated
- **Table View** — Sortable, filterable product table with export

### Inventory
- Low stock banner alert (visible to both cashier and admin)
- Export inventory as CSV or JSON
- Per-product minimum stock thresholds

---

## 🖥️ Tech Stack

| Layer    | Technology                        |
|----------|-----------------------------------|
| Frontend | HTML, CSS, Vanilla JavaScript     |
| Backend  | Node.js, Express                  |
| Database | Excel (.xlsx) via SheetJS (xlsx)  |
| Fonts    | Google Fonts — DM Sans, DM Mono  |

---

## 📁 Project Structure

```
pos-backend/
├── index.html        # Frontend — all UI, cashier & admin views
├── server.js         # Backend — REST API, Excel read/write
├── package.json      # Node.js dependencies
├── .gitignore        # Excludes database and node_modules
└── pos_database.xlsx # ⚠️ NOT in repo — generated on first run
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v16 or higher

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/jannoksz/mannas-tinadhan-pos.git
cd mannas-tinadhan-pos
```

**2. Install dependencies**
```bash
npm install express xlsx cors body-parser
```

**3. Set up the database**

Create a file named `pos_database.xlsx` in the project folder with these sheets:
- `Products`
- `Sales`
- `Sales_Summary`
- `Restock_History`
- `Price_Change_Log`
- `Stock_Adjustments`
- `Min_Stock_Config`

> The server will auto-create missing sheets on first run.

**4. Start the server**
```bash
node server.js
```

**5. Open the app**

Go to **http://localhost:3000** in your browser or tablet.

---

## 🔐 Default Login Credentials

| Role    | Username  | Password     |
|---------|-----------|--------------|
| Admin   | `admin`   | `admin123`   |
| Cashier | `cashier` | `cashier123` |

> ⚠️ Change these credentials in `server.js` before deploying.

---

## 📊 Excel Database Sheets

| Sheet               | Description                              |
|---------------------|------------------------------------------|
| `Products`          | Product catalog with stock levels        |
| `Sales`             | One row per item per transaction         |
| `Sales_Summary`     | One row per transaction                  |
| `Restock_History`   | Every restock event                      |
| `Price_Change_Log`  | Automatic log of price changes           |
| `Stock_Adjustments` | Manual stock corrections with reason     |
| `Min_Stock_Config`  | Per-product minimum stock thresholds     |

---

## 📱 Recommended Usage

- Best used on a **10–12" tablet** in landscape mode
- Run the Node.js server on a local PC or mini PC
- Connect the tablet to the same local network and open via IP address (e.g. `http://192.168.1.x:3000`)

---

## 🗂️ Product Categories

- 🥛 Dairy Products
- 🍞 Bread & Buns
- 🥫 Sauces & Condiments
- 🍖 Meat Products
- 🍟 Frozen Products
- 📦 Packaging Supplies

---

## 📄 License

This project is private and intended for personal/business use by Manna's Tinadhan.
