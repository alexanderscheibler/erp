#!/bin/bash
set -e

echo
echo "=== 1. Initializing Odoo Database & Modules with Demo Data ==="
/entrypoint.sh odoo \
    --db_host=db \
    --db_user=odoo \
    --db_password=odoo \
    -d odoo_db \
    -i stock,point_of_sale,sale_management \
    --without-demo=False \
    --stop-after-init

echo
echo "=== 2. Configuring Multi-Location, Shelves & Seeding Stock ==="
/entrypoint.sh odoo shell \
    --db_host=db \
    --db_user=odoo \
    --db_password=odoo \
    -d odoo_db \
    --no-http <<'PYEOF'

# Enable Storage Locations + Multi-Step Routes
config = env['res.config.settings'].sudo().create({
    'group_stock_multi_locations': True,
    'group_stock_adv_location': True,
})
config.sudo().execute()
env.cr.commit()
print("SUCCESS: Multi-location + routes enabled.")

# Create shelf locations under WH/Stock
stock_loc = env.ref('stock.stock_location_stock')
locs = env['stock.location'].create([
    {'name': 'Shelf A', 'location_id': stock_loc.id, 'usage': 'internal'},
    {'name': 'Shelf B', 'location_id': stock_loc.id, 'usage': 'internal'},
    {'name': 'Shelf C', 'location_id': stock_loc.id, 'usage': 'internal'},
])
shelf_a = locs[0]
shelf_b = locs[1]
env.cr.commit()
print("SUCCESS: Shelf locations created.")

# Make consumable demo products storable (Odoo 19: is_storable boolean replaces type='product')
templates = env['product.template'].search([('type', '=', 'consu')], limit=6)
templates.write({'is_storable': True})
env.cr.commit()
print(f"SUCCESS: Marked {len(templates)} products as storable.")

# Seed on-hand stock into shelves
products = templates.mapped('product_variant_ids')[:6]
seeded = 0
for p in products[:3]:
    try:
        env['stock.quant']._update_available_quantity(p, shelf_a, 50.0)
        seeded += 1
    except Exception as e:
        print(f"  Skipped {p.display_name}: {e}")
for p in products[3:]:
    try:
        env['stock.quant']._update_available_quantity(p, shelf_b, 50.0)
        seeded += 1
    except Exception as e:
        print(f"  Skipped {p.display_name}: {e}")
env.cr.commit()
print(f"SUCCESS: Seeded {seeded} products across Shelf A and Shelf B.")

# PROPER FIX: Process orderpoints synchronously before server boot
# The scheduler sits on 'stock.rule', not 'procurement.group'.
try:
    env['stock.rule'].sudo().run_scheduler(use_new_cursor=False)
    env.cr.commit()
    print("SUCCESS: Procurement scheduler pre-run complete — no startup race condition.")
except Exception as e:
    env.cr.rollback()
    print(f"WARNING: Scheduler pre-run failed: {repr(e)}")
PYEOF

echo
echo "=== 3. Starting Odoo Server ==="
exec /entrypoint.sh odoo \
    --db_host=db \
    --db_user=odoo \
    --db_password=odoo \
    -d odoo_db