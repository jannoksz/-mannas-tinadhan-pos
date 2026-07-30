/**
 * Manna's Tinadhan POS — server.js  (v2 — all features)
 * Install:  npm install express xlsx cors body-parser
 * Run:      node server.js
 */

const express    = require('express');
const XLSX       = require('xlsx');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');

const app     = express();
const PORT    = 3000;
const DB_FILE = path.join(__dirname, 'pos_database.xlsx');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// ─────────────────────────────────────────────────────
//  HELPER — read workbook, auto-create missing sheets
// ─────────────────────────────────────────────────────
function readWorkbook() {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`Database file not found: ${DB_FILE}`);
  }
  const wb = XLSX.readFile(DB_FILE);

  const sheets = [
    'Products', 'Sales', 'Sales_Summary',
    'Restock_History', 'Price_Change_Log',
    'Stock_Adjustments', 'Min_Stock_Config'
  ];
  for (const name of sheets) {
    if (!wb.SheetNames.includes(name)) {
      wb.Sheets[name] = XLSX.utils.json_to_sheet([]);
      wb.SheetNames.push(name);
    }
  }
  return wb;
}

function writeWorkbook(wb) {
  XLSX.writeFile(wb, DB_FILE);
}

// ─────────────────────────────────────────────────────
//  HELPER — SKU generator
// ─────────────────────────────────────────────────────
const SKU_PREFIX = {
  'Dairy Products':      'DRY',
  'Bread & Buns':        'BRD',
  'Sauces & Condiments': 'SCE',
  'Meat Products':       'MET',
  'Frozen Products':     'FRZ',
  'Packaging Supplies':  'PKG'
};

function generateSKU(category, products) {
  const prefix = SKU_PREFIX[category] || 'GEN';
  const count  = products.filter(p => p.Category === category).length + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

function formatDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = d.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function formatTime(d) {
  return d.toLocaleTimeString('en-US');
}

// ─────────────────────────────────────────────────────
//  GET /products
// ─────────────────────────────────────────────────────
app.get('/products', (req, res) => {
  try {
    const wb       = readWorkbook();
    const products = XLSX.utils.sheet_to_json(wb.Sheets['Products']);

    // Attach min stock config per product
    const minCfg = XLSX.utils.sheet_to_json(wb.Sheets['Min_Stock_Config']);
    const minMap = {};
    for (const r of minCfg) minMap[r.SKU] = r.MinStock;

    const enriched = products.map(p => ({
      ...p,
      MinStock: minMap[p.SKU] ?? 5   // default threshold = 5
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /add-product  (also logs restock & price change)
// ─────────────────────────────────────────────────────
app.post('/add-product', (req, res) => {
  try {
    const { name, category, price, stock } = req.body;

    if (!name || !category || price == null || stock == null) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const wb       = readWorkbook();
    let products   = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    const index    = products.findIndex(p => p.Name.toLowerCase() === name.toLowerCase());
    const now      = new Date();
    const dateStr  = formatDate(now);
    const timeStr  = formatTime(now);

    let message;
    if (index >= 0) {
      const oldPrice = products[index].Price;
      const oldStock = Number(products[index].Stock);
      products[index].Stock = oldStock + Number(stock);
      products[index].Price = Number(price);
      message = `Restocked "${name}". New stock: ${products[index].Stock}`;

      // Log restock
      let restockRows = XLSX.utils.sheet_to_json(wb.Sheets['Restock_History']);
      restockRows.push({
        Date:     dateStr,
        Time:     timeStr,
        SKU:      products[index].SKU,
        Name:     name,
        Category: category,
        QtyAdded: Number(stock),
        StockBefore: oldStock,
        StockAfter:  products[index].Stock,
        Price:    Number(price)
      });
      wb.Sheets['Restock_History'] = XLSX.utils.json_to_sheet(restockRows, {
        header: ['Date','Time','SKU','Name','Category','QtyAdded','StockBefore','StockAfter','Price']
      });

      // Log price change if different
      if (Number(price) !== Number(oldPrice)) {
        let priceLog = XLSX.utils.sheet_to_json(wb.Sheets['Price_Change_Log']);
        priceLog.push({
          Date:     dateStr,
          Time:     timeStr,
          SKU:      products[index].SKU,
          Name:     name,
          OldPrice: Number(oldPrice),
          NewPrice: Number(price),
          ChangedBy: 'admin'
        });
        wb.Sheets['Price_Change_Log'] = XLSX.utils.json_to_sheet(priceLog, {
          header: ['Date','Time','SKU','Name','OldPrice','NewPrice','ChangedBy']
        });
      }
    } else {
      const sku = generateSKU(category, products);
      products.push({ SKU: sku, Name: name, Category: category, Price: Number(price), Stock: Number(stock) });
      message = `Added new product "${name}" (${sku})`;

      // Log first restock as initial stock entry
      let restockRows = XLSX.utils.sheet_to_json(wb.Sheets['Restock_History']);
      restockRows.push({
        Date:        dateStr,
        Time:        timeStr,
        SKU:         generateSKU(category, products.slice(0,-1)),
        Name:        name,
        Category:    category,
        QtyAdded:    Number(stock),
        StockBefore: 0,
        StockAfter:  Number(stock),
        Price:       Number(price)
      });
      wb.Sheets['Restock_History'] = XLSX.utils.json_to_sheet(restockRows, {
        header: ['Date','Time','SKU','Name','Category','QtyAdded','StockBefore','StockAfter','Price']
      });
    }

    wb.Sheets['Products'] = XLSX.utils.json_to_sheet(products, {
      header: ['SKU','Name','Category','Price','Stock']
    });
    writeWorkbook(wb);
    res.json({ message, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /delete-product
// ─────────────────────────────────────────────────────
app.post('/delete-product', (req, res) => {
  try {
    const { sku }  = req.body;
    const wb       = readWorkbook();
    let products   = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    const before   = products.length;
    products       = products.filter(p => p.SKU !== sku);

    if (products.length === before) {
      return res.status(404).json({ error: 'Product not found' });
    }

    wb.Sheets['Products'] = XLSX.utils.json_to_sheet(products, {
      header: ['SKU','Name','Category','Price','Stock']
    });
    writeWorkbook(wb);
    res.json({ message: `Deleted product ${sku}`, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /checkout
// ─────────────────────────────────────────────────────
app.post('/checkout', (req, res) => {
  try {
    const { cashier, cart, cash } = req.body;

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const wb       = readWorkbook();
    let products   = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    const total    = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    if (cash < total) {
      return res.status(400).json({ error: 'Insufficient cash' });
    }

    const change = cash - total;

    for (const item of cart) {
      const p = products.find(x => x.SKU === item.sku);
      if (!p) return res.status(400).json({ error: `Product not found: ${item.name}` });
      if (p.Stock < item.qty) return res.status(400).json({ error: `Insufficient stock for ${item.name}` });
      p.Stock -= item.qty;
    }

    wb.Sheets['Products'] = XLSX.utils.json_to_sheet(products, {
      header: ['SKU','Name','Category','Price','Stock']
    });

    const now     = new Date();
    const txID    = 'R' + Date.now();
    const dateStr = formatDate(now);
    const timeStr = formatTime(now);

    let salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales']).filter(r => r.TransactionID);

    for (const item of cart) {
      salesRows.push({
        TransactionID: txID,
        Date:          dateStr,
        Time:          timeStr,
        Cashier:       cashier || 'cashier',
        ProductName:   item.name,
        SKU:           item.sku,
        Category:      item.category,
        Quantity:      item.qty,
        UnitPrice:     item.price,
        Subtotal:      item.price * item.qty,
        TotalAmount:   total
      });
    }

    wb.Sheets['Sales'] = XLSX.utils.json_to_sheet(salesRows, {
      header: ['TransactionID','Date','Time','Cashier','ProductName','SKU','Category','Quantity','UnitPrice','Subtotal','TotalAmount']
    });

    let summRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales_Summary']).filter(r => r.TransactionID);
    summRows.push({
      TransactionID: txID,
      Date:          dateStr,
      Time:          timeStr,
      Cashier:       cashier || 'cashier',
      TotalAmount:   total,
      ItemCount:     cart.reduce((s, i) => s + i.qty, 0)
    });

    wb.Sheets['Sales_Summary'] = XLSX.utils.json_to_sheet(summRows, {
      header: ['TransactionID','Date','Time','Cashier','TotalAmount','ItemCount']
    });

    writeWorkbook(wb);

    res.json({
      message: 'Sale recorded',
      transactionID: txID,
      total, cash, change,
      time: `${dateStr} ${timeStr}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /sales?date=YYYY-MM-DD
// ─────────────────────────────────────────────────────
app.get('/sales', (req, res) => {
  try {
    const { date } = req.query;
    const wb       = readWorkbook();

    let summRows  = XLSX.utils.sheet_to_json(wb.Sheets['Sales_Summary']).filter(r => r.TransactionID);
    let salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales']).filter(r => r.TransactionID);

    let filtered = summRows;

    if (date) {
      const [y, m, d] = date.split('-');
      const target = `${m}/${d}/${y}`;
      filtered = summRows.filter(r => {
        let rowDate = String(r.Date || '').trim();
        if (!isNaN(rowDate) && rowDate !== '') {
          const serial = parseInt(rowDate);
          const excelEpoch = new Date(1900, 0, 1);
          const converted  = new Date(excelEpoch.getTime() + (serial - 2) * 86400000);
          rowDate = formatDate(converted);
        }
        return rowDate === target;
      });
    }

    const result = filtered.map(tx => ({
      ...tx,
      items: salesRows.filter(r => r.TransactionID === tx.TransactionID)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /inventory-dashboard
//  Returns: total items, total stock value, low stock count, category breakdown
// ─────────────────────────────────────────────────────
app.get('/inventory-dashboard', (req, res) => {
  try {
    const wb       = readWorkbook();
    const products = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    const minCfg   = XLSX.utils.sheet_to_json(wb.Sheets['Min_Stock_Config']);
    const minMap   = {};
    for (const r of minCfg) minMap[r.SKU] = r.MinStock;

    const totalItems      = products.length;
    const totalStockValue = products.reduce((s, p) => s + (p.Price * p.Stock), 0);
    const lowStockItems   = products.filter(p => p.Stock <= (minMap[p.SKU] ?? 5));
    const outOfStock      = products.filter(p => p.Stock === 0);

    // Category breakdown
    const categories = {};
    for (const p of products) {
      if (!categories[p.Category]) categories[p.Category] = { count: 0, value: 0, items: [] };
      categories[p.Category].count++;
      categories[p.Category].value += p.Price * p.Stock;
      categories[p.Category].items.push({ name: p.Name, stock: p.Stock, price: p.Price });
    }

    res.json({
      totalItems,
      totalStockValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStock.length,
      lowStockItems: lowStockItems.map(p => ({
        sku: p.SKU, name: p.Name, stock: p.Stock, minStock: minMap[p.SKU] ?? 5
      })),
      categories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /restock-history
// ─────────────────────────────────────────────────────
app.get('/restock-history', (req, res) => {
  try {
    const wb   = readWorkbook();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Restock_History']);
    res.json([...rows].reverse()); // newest first
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /best-sellers?limit=10
// ─────────────────────────────────────────────────────
app.get('/best-sellers', (req, res) => {
  try {
    const limit    = parseInt(req.query.limit) || 10;
    const wb       = readWorkbook();
    const salesRows = XLSX.utils.sheet_to_json(wb.Sheets['Sales']).filter(r => r.TransactionID);

    // Aggregate by SKU
    const totals = {};
    for (const r of salesRows) {
      if (!totals[r.SKU]) totals[r.SKU] = { sku: r.SKU, name: r.ProductName, category: r.Category, qtyTotal: 0, revenueTotal: 0 };
      totals[r.SKU].qtyTotal      += Number(r.Quantity);
      totals[r.SKU].revenueTotal  += Number(r.Subtotal);
    }

    const sorted = Object.values(totals)
      .sort((a, b) => b.qtyTotal - a.qtyTotal)
      .slice(0, limit);

    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /export-inventory   (returns JSON; client builds CSV/Excel)
// ─────────────────────────────────────────────────────
app.get('/export-inventory', (req, res) => {
  try {
    const wb       = readWorkbook();
    const products = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /price-change-log
// ─────────────────────────────────────────────────────
app.get('/price-change-log', (req, res) => {
  try {
    const wb   = readWorkbook();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Price_Change_Log']);
    res.json([...rows].reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /set-min-stock  { sku, minStock }
// ─────────────────────────────────────────────────────
app.post('/set-min-stock', (req, res) => {
  try {
    const { sku, minStock } = req.body;
    if (!sku || minStock == null) return res.status(400).json({ error: 'Missing sku or minStock' });

    const wb  = readWorkbook();
    let rows  = XLSX.utils.sheet_to_json(wb.Sheets['Min_Stock_Config']);
    const idx = rows.findIndex(r => r.SKU === sku);
    if (idx >= 0) {
      rows[idx].MinStock = Number(minStock);
    } else {
      rows.push({ SKU: sku, MinStock: Number(minStock) });
    }
    wb.Sheets['Min_Stock_Config'] = XLSX.utils.json_to_sheet(rows, { header: ['SKU','MinStock'] });
    writeWorkbook(wb);
    res.json({ message: `Min stock for ${sku} set to ${minStock}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /adjust-stock  { sku, adjustment, reason }
//  adjustment can be positive (add) or negative (remove)
// ─────────────────────────────────────────────────────
app.post('/adjust-stock', (req, res) => {
  try {
    const { sku, adjustment, reason } = req.body;
    if (!sku || adjustment == null) return res.status(400).json({ error: 'Missing fields' });

    const wb       = readWorkbook();
    let products   = XLSX.utils.sheet_to_json(wb.Sheets['Products']);
    const p        = products.find(x => x.SKU === sku);
    if (!p) return res.status(404).json({ error: 'Product not found' });

    const before  = Number(p.Stock);
    const after   = Math.max(0, before + Number(adjustment));
    p.Stock       = after;

    wb.Sheets['Products'] = XLSX.utils.json_to_sheet(products, {
      header: ['SKU','Name','Category','Price','Stock']
    });

    // Log adjustment
    const now     = new Date();
    let adjRows   = XLSX.utils.sheet_to_json(wb.Sheets['Stock_Adjustments']);
    adjRows.push({
      Date:        formatDate(now),
      Time:        formatTime(now),
      SKU:         sku,
      Name:        p.Name,
      Adjustment:  Number(adjustment),
      StockBefore: before,
      StockAfter:  after,
      Reason:      reason || 'Manual adjustment'
    });
    wb.Sheets['Stock_Adjustments'] = XLSX.utils.json_to_sheet(adjRows, {
      header: ['Date','Time','SKU','Name','Adjustment','StockBefore','StockAfter','Reason']
    });

    writeWorkbook(wb);
    res.json({ message: `Stock adjusted: ${before} → ${after}`, stockBefore: before, stockAfter: after });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /stock-adjustments
// ─────────────────────────────────────────────────────
app.get('/stock-adjustments', (req, res) => {
  try {
    const wb   = readWorkbook();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Stock_Adjustments']);
    res.json([...rows].reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  Start server
// ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Manna's Tinadhan POS running at http://localhost:${PORT}`);
  console.log(`📊  Database: ${DB_FILE}\n`);
});
