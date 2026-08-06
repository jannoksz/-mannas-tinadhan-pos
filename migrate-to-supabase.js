/**
 * Manna's Tinadhan POS — one-time migration
 * Imports the old pos_database.xlsx into Supabase.
 *
 * Usage:  node migrate-to-supabase.js
 *   (or:  npm run migrate)
 *
 * Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env — same as server.js.
 * Safe to re-run: uses upsert on products (by sku) and skips a sheet entirely
 * if it has no data rows, so it won't create duplicate sales/logs on a second run
 * as long as you only run it once against a fresh database.
 */

require('dotenv').config();

const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const XLSX_PATH = path.join(__dirname, 'pos_database.xlsx');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.error('    Copy .env.example to .env and fill in your Supabase project credentials.');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.log(`  (sheet "${sheetName}" not found — skipping)`);
    return [];
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return rows;
}

async function insertInBatches(table, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function migrateProducts(workbook) {
  const rows = readSheet(workbook, 'Products');
  if (!rows.length) {
    console.log('Products: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    sku: r.SKU,
    name: r.Name,
    category: r.Category,
    price: Number(r.Price) || 0,
    stock: Number(r.Stock) || 0,
    min_stock: r.MinStock != null ? Number(r.MinStock) : 5 // xlsx has no MinStock column — falls back to schema default
  }));

  const { error } = await supabase.from('products').upsert(mapped, { onConflict: 'sku' });
  if (error) throw new Error(`products: ${error.message}`);
  console.log(`Products: migrated ${mapped.length} row(s).`);
}

async function migrateSales(workbook) {
  const rows = readSheet(workbook, 'Sales');
  if (!rows.length) {
    console.log('Sales: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    transaction_id: r.TransactionID,
    date: r.Date,
    time: r.Time,
    cashier: r.Cashier,
    product_name: r.ProductName,
    sku: r.SKU,
    category: r.Category,
    quantity: Number(r.Quantity) || 0,
    unit_price: Number(r.UnitPrice) || 0,
    subtotal: Number(r.Subtotal) || 0,
    total_amount: Number(r.TotalAmount) || 0
  }));

  await insertInBatches('sales', mapped);
  console.log(`Sales: migrated ${mapped.length} row(s).`);
}

async function migrateSalesSummary(workbook) {
  const rows = readSheet(workbook, 'Sales_Summary');
  if (!rows.length) {
    console.log('Sales_Summary: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    transaction_id: r.TransactionID,
    date: r.Date,
    time: r.Time,
    cashier: r.Cashier,
    total_amount: Number(r.TotalAmount) || 0,
    item_count: Number(r.ItemCount) || 0,
    cash: r.Cash != null ? Number(r.Cash) : null,
    change: r.Change != null ? Number(r.Change) : null
  }));

  const { error } = await supabase.from('sales_summary').upsert(mapped, { onConflict: 'transaction_id' });
  if (error) throw new Error(`sales_summary: ${error.message}`);
  console.log(`Sales_Summary: migrated ${mapped.length} row(s).`);
}

async function migrateRestockHistory(workbook) {
  const rows = readSheet(workbook, 'Restock_History');
  if (!rows.length) {
    console.log('Restock_History: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    date: r.Date,
    time: r.Time,
    sku: r.SKU,
    name: r.Name,
    category: r.Category,
    qty_added: Number(r.QtyAdded) || 0,
    stock_before: Number(r.StockBefore) || 0,
    stock_after: Number(r.StockAfter) || 0,
    price: Number(r.Price) || 0
  }));

  await insertInBatches('restock_history', mapped);
  console.log(`Restock_History: migrated ${mapped.length} row(s).`);
}

async function migratePriceChangeLog(workbook) {
  const rows = readSheet(workbook, 'Price_Change_Log');
  if (!rows.length) {
    console.log('Price_Change_Log: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    date: r.Date,
    time: r.Time,
    sku: r.SKU,
    name: r.Name,
    old_price: Number(r.OldPrice) || 0,
    new_price: Number(r.NewPrice) || 0,
    changed_by: r.ChangedBy || 'admin'
  }));

  await insertInBatches('price_change_log', mapped);
  console.log(`Price_Change_Log: migrated ${mapped.length} row(s).`);
}

async function migrateStockAdjustments(workbook) {
  const rows = readSheet(workbook, 'Stock_Adjustments');
  if (!rows.length) {
    console.log('Stock_Adjustments: nothing to migrate.');
    return;
  }

  const mapped = rows.map(r => ({
    date: r.Date,
    time: r.Time,
    sku: r.SKU,
    name: r.Name,
    adjustment: Number(r.Adjustment) || 0,
    stock_before: Number(r.StockBefore) || 0,
    stock_after: Number(r.StockAfter) || 0,
    reason: r.Reason || 'Manual adjustment'
  }));

  await insertInBatches('stock_adjustments', mapped);
  console.log(`Stock_Adjustments: migrated ${mapped.length} row(s).`);
}

async function main() {
  console.log(`\n📦  Migrating ${XLSX_PATH} → Supabase\n`);

  const workbook = XLSX.readFile(XLSX_PATH);

  // Order matters: products first (sales/restock reference SKUs),
  // sales_summary before sales is not required but kept for readability.
  await migrateProducts(workbook);
  await migrateSalesSummary(workbook);
  await migrateSales(workbook);
  await migrateRestockHistory(workbook);
  await migratePriceChangeLog(workbook);
  await migrateStockAdjustments(workbook);

  console.log('\n✅  Migration complete.\n');
}

main().catch(err => {
  console.error('\n❌  Migration failed:', err.message);
  process.exit(1);
});
