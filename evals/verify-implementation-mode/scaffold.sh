#!/usr/bin/env bash
# Fixture: a plan with three scenarios and a spec that covers one, leaves one result unasserted, and omits one.
set -euo pipefail
mkdir -p src/tests/ui/cart qa-kit-artifacts

cat > src/tests/ui/cart/cart.spec.ts <<'EOF'
import { test, expect } from '@playwright/test'

test.describe('Cart', () => {
  test('Add item to cart', async ({ page }) => {
    await page.goto('/products/1')
    await page.getByRole('button', { name: 'Add to cart' }).click()
    await expect(page.getByTestId('cart-badge')).toHaveText('1')
  })

  test('Remove item from cart', async ({ page }) => {
    await page.goto('/cart')
    await page.getByRole('button', { name: 'Remove' }).click()
  })
})
EOF

cat > qa-kit-artifacts/ABC-2-test-plan.md <<'EOF'
# Test Plan: Cart

**Jira Story**: ABC-2
**Test Type**: ui

## Test Scenarios

### 1. Positive Scenarios (Critical-High)

ID: TC-001
Test: Add item to cart
Type: UI
Level: Smoke
Priority: Critical

Steps:
1. Open the product page
2. Click Add to cart

Expected Results:
- The cart badge shows 1

ID: TC-002
Test: Remove item from cart
Type: UI
Level: Sanity
Priority: High

Steps:
1. Open the cart with one item
2. Click Remove

Expected Results:
- The cart shows the empty-cart message
- The cart badge disappears

ID: TC-003
Test: Apply a valid coupon
Type: UI
Level: Sanity
Priority: High

Steps:
1. Open the cart with one item
2. Enter a valid coupon and apply it

Expected Results:
- The total is reduced by the coupon value
EOF
