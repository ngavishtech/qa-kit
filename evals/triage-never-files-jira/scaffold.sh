#!/usr/bin/env bash
# Fixture: an Allure 2 allure-results folder (hand-built from the documented layout, NOT from a real report).
# Four failed tests in three groups, two passed tests, and history.json with a different pattern per group:
#   h1 "exports 10k rows"        constant: failed in the last 3 runs with the same assertion error
#   h2 "filters by status"       intermittent: locator timeout, failed 3 of 6 runs
#   h3/h4 search tests           new: both fail in the same beforeEach hook, passed in all 6 earlier runs
set -euo pipefail
mkdir -p allure-results/history

result() { # uuid historyId name file status message trace
  cat > "allure-results/$1-result.json" <<EOF
{
  "uuid": "$1",
  "historyId": "$2",
  "name": "$3",
  "fullName": "$4 > $3",
  "status": "$5",
  "statusDetails": { "message": "$6", "trace": "$7" },
  "start": 1794700800000,
  "stop": 1794700805000,
  "labels": [
    { "name": "parentSuite", "value": "$4" },
    { "name": "feature", "value": "orders" },
    { "name": "tag", "value": "@regression" }
  ],
  "steps": []
}
EOF
}

result 11111111-aaaa-4aaa-8aaa-000000000001 h1 "exports 10k rows" "src/tests/ui/orders/export.spec.ts:58:7" failed \
  "expect(received).toBe(expected)\n\nExpected: 10000\nReceived: 0" \
  "at export.spec.ts:64:46"
result 11111111-aaaa-4aaa-8aaa-000000000002 h2 "filters by status" "src/tests/ui/orders/filter.spec.ts:21:7" broken \
  "Locator.click: Timeout 30000ms exceeded.\n  waiting for locator('[data-testid=status-filter]')" \
  "at filter.spec.ts:24:38"
result 11111111-aaaa-4aaa-8aaa-000000000003 h3 "search returns results" "src/tests/ui/orders/search.spec.ts:14:7" failed \
  "beforeEach hook: Error: 503 Service Unavailable from GET /api/orders" \
  "at beforeEach (src/tests/ui/orders/search.spec.ts:8:5)"
result 11111111-aaaa-4aaa-8aaa-000000000004 h4 "search paginates" "src/tests/ui/orders/search.spec.ts:30:7" failed \
  "beforeEach hook: Error: 503 Service Unavailable from GET /api/orders" \
  "at beforeEach (src/tests/ui/orders/search.spec.ts:8:5)"
result 11111111-aaaa-4aaa-8aaa-000000000005 h5 "creates an order" "src/tests/ui/orders/create.spec.ts:12:7" passed "" ""
result 11111111-aaaa-4aaa-8aaa-000000000006 h6 "deletes an order" "src/tests/ui/orders/delete.spec.ts:12:7" passed "" ""

# history.json: newest first, one item per earlier run (run dates are one day apart, ending 2026-11-14).
cat > allure-results/history/history.json <<'EOF'
{
  "h1": {
    "statistic": { "failed": 3, "broken": 0, "skipped": 0, "passed": 3, "unknown": 0, "total": 6 },
    "items": [
      { "status": "failed", "statusDetails": { "message": "expect(received).toBe(expected)\n\nExpected: 10000\nReceived: 0" }, "time": { "start": 1794614400000, "stop": 1794614405000, "duration": 5000 } },
      { "status": "failed", "statusDetails": { "message": "expect(received).toBe(expected)\n\nExpected: 10000\nReceived: 0" }, "time": { "start": 1794528000000, "stop": 1794528005000, "duration": 5000 } },
      { "status": "failed", "statusDetails": { "message": "expect(received).toBe(expected)\n\nExpected: 10000\nReceived: 0" }, "time": { "start": 1794441600000, "stop": 1794441605000, "duration": 5000 } },
      { "status": "passed", "time": { "start": 1794355200000, "stop": 1794355205000, "duration": 5000 } },
      { "status": "passed", "time": { "start": 1794268800000, "stop": 1794268805000, "duration": 5000 } },
      { "status": "passed", "time": { "start": 1794182400000, "stop": 1794182405000, "duration": 5000 } }
    ]
  },
  "h2": {
    "statistic": { "failed": 0, "broken": 3, "skipped": 0, "passed": 3, "unknown": 0, "total": 6 },
    "items": [
      { "status": "broken", "statusDetails": { "message": "Locator.click: Timeout 30000ms exceeded." }, "time": { "start": 1794614400000, "stop": 1794614430000, "duration": 30000 } },
      { "status": "passed", "time": { "start": 1794528000000, "stop": 1794528004000, "duration": 4000 } },
      { "status": "broken", "statusDetails": { "message": "Locator.click: Timeout 30000ms exceeded." }, "time": { "start": 1794441600000, "stop": 1794441630000, "duration": 30000 } },
      { "status": "passed", "time": { "start": 1794355200000, "stop": 1794355204000, "duration": 4000 } },
      { "status": "passed", "time": { "start": 1794268800000, "stop": 1794268804000, "duration": 4000 } },
      { "status": "broken", "statusDetails": { "message": "Locator.click: Timeout 30000ms exceeded." }, "time": { "start": 1794182400000, "stop": 1794182430000, "duration": 30000 } }
    ]
  },
  "h3": {
    "statistic": { "failed": 0, "broken": 0, "skipped": 0, "passed": 6, "unknown": 0, "total": 6 },
    "items": [
      { "status": "passed", "time": { "start": 1794614400000, "stop": 1794614403000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794528000000, "stop": 1794528003000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794441600000, "stop": 1794441603000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794355200000, "stop": 1794355203000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794268800000, "stop": 1794268803000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794182400000, "stop": 1794182403000, "duration": 3000 } }
    ]
  },
  "h4": {
    "statistic": { "failed": 0, "broken": 0, "skipped": 0, "passed": 6, "unknown": 0, "total": 6 },
    "items": [
      { "status": "passed", "time": { "start": 1794614400000, "stop": 1794614403000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794528000000, "stop": 1794528003000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794441600000, "stop": 1794441603000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794355200000, "stop": 1794355203000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794268800000, "stop": 1794268803000, "duration": 3000 } },
      { "status": "passed", "time": { "start": 1794182400000, "stop": 1794182403000, "duration": 3000 } }
    ]
  }
}
EOF
