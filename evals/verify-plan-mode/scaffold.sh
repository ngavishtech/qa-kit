#!/usr/bin/env bash
# Fixture: a tiny Playwright repo with two existing tests and a plan with one duplicate, one partial and one new scenario.
set -euo pipefail
mkdir -p src/tests/ui/orders qa-kit-artifacts

cat > playwright.config.ts <<'EOF'
import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: 'src/tests', projects: [{ name: 'chromium' }] })
EOF

cat > src/tests/ui/orders/export.spec.ts <<'EOF'
import { test, expect } from '@playwright/test'

test.describe('Order export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/orders')
  })

  test('exports an empty order list', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click()
    const download = await page.waitForEvent('download')
    expect(await countRows(download)).toBe(0)
  })

  test('exports 10 rows', async ({ page }) => {
    await seedOrders(page, 10)
    await page.getByRole('button', { name: 'Export' }).click()
    const download = await page.waitForEvent('download')
    expect(await countRows(download)).toBe(10)
  })
})
EOF

cat > qa-kit-artifacts/ABC-1-test-plan.md <<'EOF'
# Test Plan: Order export

**Jira Story**: ABC-1
**Test Type**: ui

## Test Scenarios

### 1. Positive Scenarios (Critical-High)

ID: TC-003
Test: Export empty order list
Type: UI
Level: Sanity
Priority: Medium

Description:
Verify that exporting an order list with no orders downloads a file with no data rows.

Steps:
1. Open the orders page with no orders
2. Click Export

Expected Results:
- The downloaded file has no data rows

ID: TC-004
Test: Export 10k rows
Type: UI
Level: Regression
Priority: High

Description:
Verify that exporting a very large order list downloads every row.

Steps:
1. Create 10000 orders
2. Open the orders page
3. Click Export

Expected Results:
- The downloaded file has 10000 data rows

ID: TC-005
Test: Export as XLSX
Type: UI
Level: Sanity
Priority: Medium

Description:
Verify that the order list can be exported as an XLSX file.

Steps:
1. Open the orders page
2. Choose the XLSX format and click Export

Expected Results:
- A file with the .xlsx extension is downloaded
EOF
