/**
 * Manna's Tinadhan POS — server.js  (v3 — Supabase backend)
 * Install:  npm install express cors body-parser @supabase/supabase-js dotenv
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (see .env.example)
 * Run:      node server.js
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.error('    Copy .env.example to .env and fill in your Supabase project credentials.');
  process.exit(1);
}

// Service-role key: server-side only, full read/write, bypasses RLS.
// NEVER send this key to the browser/frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// ─────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────
const SKU_PREFIX = {
  'Dairy Products':      'DRY',
  'Bread & Buns':        'BRD',
  'Sauces & Condiments': 'SCE',
  'Meat Products':       'MET',
  'Frozen Products':     'FRZ',
  'Packaging Supplies':  'PKG'
};

async function generateSKU(category) {
  const prefix = SKU_PREFIX[category] || 'GEN';
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category', category);
  if (error) throw error;
  return `${prefix}-${String((count || 0) + 1).padStart(3, '0')}`;
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

// Map DB rows (snake_case) -> API shape (PascalCase), unchanged from the old xlsx version
const mapProduct    = p => ({ SKU: p.sku, Name: p.name, Category: p.category, Price: Number(p.price), Stock: Number(p.stock), MinStock: Number(p.min_stock) });
const mapRestock    = r => ({ Date: r.date, Time: r.time, SKU: r.sku, Name: r.name, Category: r.category, QtyAdded: Number(r.qty_added), StockBefore: Number(r.stock_before), StockAfter: Number(r.stock_after), Price: Number(r.price) });
const mapPriceLog   = r => ({ Date: r.date, Time: r.time, SKU: r.sku, Name: r.name, OldPrice: Number(r.old_price), NewPrice: Number(r.new_price), ChangedBy: r.changed_by });
const mapAdjustment = r => ({ Date: r.date, Time: r.time, SKU: r.sku, Name: r.name, Adjustment: Number(r.adjustment), StockBefore: Number(r.stock_before), StockAfter: Number(r.stock_after), Reason: r.reason });
const mapSaleItem   = r => ({ TransactionID: r.transaction_id, Date: r.date, Time: r.time, Cashier: r.cashier, ProductName: r.product_name, SKU: r.sku, Category: r.category, Quantity: Number(r.quantity), UnitPrice: Number(r.unit_price), Subtotal: Number(r.subtotal), TotalAmount: Number(r.total_amount) });

// ─────────────────────────────────────────────────────
//  GET /products
// ─────────────────────────────────────────────────────
app.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('sku');
    if (error) throw error;
    res.json(data.map(mapProduct));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /add-product  (also logs restock & price change)
// ─────────────────────────────────────────────────────
app.post('/add-product', async (req, res) => {
  try {
    const { name, category, price, stock } = req.body;

    if (!name || !category || price == null || stock == null) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const now     = new Date();
    const dateStr = formatDate(now);
    const timeStr = formatTime(now);

    const { data: matches, error: findErr } = await supabase
      .from('products').select('*').ilike('name', name);
    if (findErr) throw findErr;
    const existing = matches && matches[0];

    let message;

    if (existing) {
      const oldPrice = Number(existing.price);
      const oldStock = Number(existing.stock);
      const newStock = oldStock + Number(stock);
      const newPrice = Number(price);

      const { error: updErr } = await supabase
        .from('products')
        .update({ stock: newStock, price: newPrice, updated_at: now.toISOString() })
        .eq('sku', existing.sku);
      if (updErr) throw updErr;

      message = `Restocked "${name}". New stock: ${newStock}`;

      const { error: restockErr } = await supabase.from('restock_history').insert({
        date: dateStr, time: timeStr, sku: existing.sku, name, category,
        qty_added: Number(stock), stock_before: oldStock, stock_after: newStock, price: newPrice
      });
      if (restockErr) throw restockErr;

      if (newPrice !== oldPrice) {
        const { error: priceErr } = await supabase.from('price_change_log').insert({
          date: dateStr, time: timeStr, sku: existing.sku, name,
          old_price: oldPrice, new_price: newPrice, changed_by: 'admin'
        });
        if (priceErr) throw priceErr;
      }
    } else {
      const sku = await generateSKU(category);

      const { error: insErr } = await supabase.from('products').insert({
        sku, name, category, price: Number(price), stock: Number(stock), min_stock: 5
      });
      if (insErr) throw insErr;

      message = `Added new product "${name}" (${sku})`;

      const { error: restockErr } = await supabase.from('restock_history').insert({
        date: dateStr, time: timeStr, sku, name, category,
        qty_added: Number(stock), stock_before: 0, stock_after: Number(stock), price: Number(price)
      });
      if (restockErr) throw restockErr;
    }

    const { data: products, error: listErr } = await supabase.from('products').select('*').order('sku');
    if (listErr) throw listErr;

    res.json({ message, products: products.map(mapProduct) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /delete-product
// ─────────────────────────────────────────────────────
app.post('/delete-product', async (req, res) => {
  try {
    const { sku } = req.body;

    const { data: existing, error: findErr } = await supabase.from('products').select('sku').eq('sku', sku);
    if (findErr) throw findErr;
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { error: delErr } = await supabase.from('products').delete().eq('sku', sku);
    if (delErr) throw delErr;

    const { data: products, error: listErr } = await supabase.from('products').select('*').order('sku');
    if (listErr) throw listErr;

    res.json({ message: `Deleted product ${sku}`, products: products.map(mapProduct) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /checkout
// ─────────────────────────────────────────────────────
app.post('/checkout', async (req, res) => {
  try {
    const { cashier, cart, cash } = req.body;

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const skus = cart.map(i => i.sku);
    const { data: products, error: prodErr } = await supabase.from('products').select('*').in('sku', skus);
    if (prodErr) throw prodErr;

    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (cash < total) {
      return res.status(400).json({ error: 'Insufficient cash' });
    }
    const change = cash - total;

    for (const item of cart) {
      const p = products.find(x => x.sku === item.sku);
      if (!p) return res.status(400).json({ error: `Product not found: ${item.name}` });
      if (Number(p.stock) < item.qty) return res.status(400).json({ error: `Insufficient stock for ${item.name}` });
    }

    for (const item of cart) {
      const p = products.find(x => x.sku === item.sku);
      const newStock = Number(p.stock) - item.qty;
      const { error: updErr } = await supabase.from('products').update({ stock: newStock }).eq('sku', item.sku);
      if (updErr) throw updErr;
    }

    const now       = new Date();
    const txID      = 'R' + Date.now();
    const dateStr   = formatDate(now);
    const timeStr   = formatTime(now);
    const itemCount = cart.reduce((s, i) => s + i.qty, 0);

    const { error: summErr } = await supabase.from('sales_summary').insert({
      transaction_id: txID, date: dateStr, time: timeStr, cashier: cashier || 'cashier',
      total_amount: total, item_count: itemCount, cash, change
    });
    if (summErr) throw summErr;

    const salesRows = cart.map(item => ({
      transaction_id: txID, date: dateStr, time: timeStr, cashier: cashier || 'cashier',
      product_name: item.name, sku: item.sku, category: item.category,
      quantity: item.qty, unit_price: item.price, subtotal: item.price * item.qty, total_amount: total
    }));
    const { error: salesErr } = await supabase.from('sales').insert(salesRows);
    if (salesErr) throw salesErr;

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
app.get('/sales', async (req, res) => {
  try {
    const { date } = req.query;

    let query = supabase.from('sales_summary').select('*').order('created_at', { ascending: false });
    if (date) {
      const [y, m, d] = date.split('-');
      query = query.eq('date', `${m}/${d}/${y}`);
    }
    const { data: summRows, error: summErr } = await query;
    if (summErr) throw summErr;

    const txIDs = summRows.map(r => r.transaction_id);
    let salesRows = [];
    if (txIDs.length) {
      const { data, error } = await supabase.from('sales').select('*').in('transaction_id', txIDs);
      if (error) throw error;
      salesRows = data;
    }

    const result = summRows.map(tx => ({
      TransactionID: tx.transaction_id,
      Date: tx.date,
      Time: tx.time,
      Cashier: tx.cashier,
      TotalAmount: Number(tx.total_amount),
      ItemCount: Number(tx.item_count),
      items: salesRows.filter(r => r.transaction_id === tx.transaction_id).map(mapSaleItem)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /inventory-dashboard
// ─────────────────────────────────────────────────────
app.get('/inventory-dashboard', async (req, res) => {
  try {
    const { data: products, error } = await supabase.from('products').select('*');
    if (error) throw error;

    const totalItems      = products.length;
    const totalStockValue = products.reduce((s, p) => s + Number(p.price) * Number(p.stock), 0);
    const lowStockItems   = products.filter(p => Number(p.stock) <= Number(p.min_stock));
    const outOfStock      = products.filter(p => Number(p.stock) === 0);

    const categories = {};
    for (const p of products) {
      if (!categories[p.category]) categories[p.category] = { count: 0, value: 0, items: [] };
      categories[p.category].count++;
      categories[p.category].value += Number(p.price) * Number(p.stock);
      categories[p.category].items.push({ name: p.name, stock: Number(p.stock), price: Number(p.price) });
    }

    res.json({
      totalItems,
      totalStockValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStock.length,
      lowStockItems: lowStockItems.map(p => ({
        sku: p.sku, name: p.name, stock: Number(p.stock), minStock: Number(p.min_stock)
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
app.get('/restock-history', async (req, res) => {
  try {
    const { data, error } = await supabase.from('restock_history').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data.map(mapRestock));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /best-sellers?limit=10
// ─────────────────────────────────────────────────────
app.get('/best-sellers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { data: salesRows, error } = await supabase.from('sales').select('*');
    if (error) throw error;

    const totals = {};
    for (const r of salesRows) {
      if (!totals[r.sku]) totals[r.sku] = { sku: r.sku, name: r.product_name, category: r.category, qtyTotal: 0, revenueTotal: 0 };
      totals[r.sku].qtyTotal     += Number(r.quantity);
      totals[r.sku].revenueTotal += Number(r.subtotal);
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
//  GET /export-inventory
// ─────────────────────────────────────────────────────
app.get('/export-inventory', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('sku,name,category,price,stock').order('sku');
    if (error) throw error;
    res.json(data.map(p => ({ SKU: p.sku, Name: p.name, Category: p.category, Price: Number(p.price), Stock: Number(p.stock) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /price-change-log
// ─────────────────────────────────────────────────────
app.get('/price-change-log', async (req, res) => {
  try {
    const { data, error } = await supabase.from('price_change_log').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data.map(mapPriceLog));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /set-min-stock  { sku, minStock }
// ─────────────────────────────────────────────────────
app.post('/set-min-stock', async (req, res) => {
  try {
    const { sku, minStock } = req.body;
    if (!sku || minStock == null) return res.status(400).json({ error: 'Missing sku or minStock' });

    const { data, error } = await supabase
      .from('products')
      .update({ min_stock: Number(minStock) })
      .eq('sku', sku)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Product not found' });

    res.json({ message: `Min stock for ${sku} set to ${minStock}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /adjust-stock  { sku, adjustment, reason }
//  adjustment can be positive (add) or negative (remove)
// ─────────────────────────────────────────────────────
app.post('/adjust-stock', async (req, res) => {
  try {
    const { sku, adjustment, reason } = req.body;
    if (!sku || adjustment == null) return res.status(400).json({ error: 'Missing fields' });

    const { data: matches, error: findErr } = await supabase.from('products').select('*').eq('sku', sku);
    if (findErr) throw findErr;
    const p = matches && matches[0];
    if (!p) return res.status(404).json({ error: 'Product not found' });

    const before = Number(p.stock);
    const after  = Math.max(0, before + Number(adjustment));

    const { error: updErr } = await supabase.from('products').update({ stock: after }).eq('sku', sku);
    if (updErr) throw updErr;

    const now = new Date();
    const { error: logErr } = await supabase.from('stock_adjustments').insert({
      date: formatDate(now), time: formatTime(now), sku, name: p.name,
      adjustment: Number(adjustment), stock_before: before, stock_after: after,
      reason: reason || 'Manual adjustment'
    });
    if (logErr) throw logErr;

    res.json({ message: `Stock adjusted: ${before} → ${after}`, stockBefore: before, stockAfter: after });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /stock-adjustments
// ─────────────────────────────────────────────────────
app.get('/stock-adjustments', async (req, res) => {
  try {
    const { data, error } = await supabase.from('stock_adjustments').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data.map(mapAdjustment));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  Start server
// ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Manna's Tinadhan POS running at http://localhost:${PORT}`);
  console.log(`📊  Database: Supabase (${process.env.SUPABASE_URL})\n`);
});
